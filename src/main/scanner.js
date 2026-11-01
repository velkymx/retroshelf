'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { matchKnownGame } = require('./knownGames');
const { parseBundleHints } = require('./dosboxConfig');

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;
const RUNNABLE_EXT = /\.(exe|com|bat)$/i;
const CD_IMAGE_EXT = /\.(iso|cue)$/i;
// Executables that are almost never the thing you want to launch.
const NON_GAME = /^(install|winstall|setup|setsound|setmuse|config|configur|sound|detect|detectcd|autodet|deice|catalog|readme|help|info|uninst|uvconfig|dos4gw|dos32a|pmodew|cwsdpmi|exists|godir|space|choice|pkunz|pkunzjr|cleardrv|bootdisk|emuset|instgame|__insth|drv_.*|.*ed95|.*edit|.*cht|.*crack|rkernel|centerjs|load)$/i;
// SCUMM data files that identify a ScummVM game when no DOS executable is around.
const SCUMM_DATA = /^(\d{3}\.lfl|.*\.la0|(tentacle|atlantis|monkey\d?|samnmax|maniac|zak|loom|indy3)\.00\d)$/i;
// DOS extenders: the game runs in protected mode and needs a 386+.
const EXTENDERS = ['dos4gw.exe', 'dos32a.exe', 'pmodew.exe', 'cwsdpmi.exe', 'dos4gw.ovl', 'rtm.exe', 'dpmi16bi.ovl'];

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readText(file) {
  try {
    // DOS-era files are CP437/Latin-1; latin1 decoding never throws and keeps ASCII intact.
    return fs.readFileSync(file, 'latin1');
  } catch {
    return '';
  }
}

function gameId(folder) {
  return crypto.createHash('sha1').update(path.resolve(folder)).digest('hex').slice(0, 12);
}

function prettifyName(name) {
  return name
    // Drop "(1995)(Publisher)(Rev1)"-style tags; they are not part of the title.
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .replace(/[_.]+/g, ' ')
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** True if a name is a legal DOS 8.3 directory name, so it can be reached with `cd \NAME`. */
function isDos83(name) {
  return /^[A-Za-z0-9_\-~!#$%&'()@^{}]{1,8}(\.[A-Za-z0-9_\-~!#$%&'()@^{}]{1,3})?$/.test(name);
}

/** Resolve a DOS-style relative path (".\foo\bar") against a host directory. */
function resolveDosPath(baseDir, dosPath) {
  const cleaned = dosPath.replace(/^"|"$/g, '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (cleaned === '.' || cleaned === '') return baseDir;
  return path.resolve(baseDir, cleaned);
}

/** Split a command line into tokens, honouring double quotes. */
function tokenize(line) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line))) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  return tokens;
}

function extractAutoexec(confText) {
  const lines = confText.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => /^\s*\[autoexec\]\s*$/i.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[[a-z0-9_]+\]\s*$/i.test(line)) break;
    out.push(line);
  }
  return out;
}

/**
 * Turn a packaged autoexec into mounts + game commands, dropping the wrapper's banner,
 * pauses and comments so the game starts straight away.
 */
function parseAutoexec(lines, baseDir) {
  const mounts = [];
  const commands = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(':')) continue;
    if (/^@?echo(\s|\.|$)/i.test(line) || /^(cls|pause|rem)(\s|$)/i.test(line)) continue;
    const tokens = tokenize(line);
    const cmd = tokens[0].toLowerCase();
    if (cmd === 'mount' && tokens.length >= 3) {
      const isCd = /-t\s+cdrom/i.test(line);
      mounts.push({ drive: tokens[1].toUpperCase(), path: resolveDosPath(baseDir, tokens[2]), kind: isCd ? 'cdrom' : 'dir' });
      continue;
    }
    if (cmd === 'imgmount' && tokens.length >= 3) {
      mounts.push({ drive: tokens[1].toUpperCase(), path: resolveDosPath(baseDir, tokens[2]), kind: 'image' });
      continue;
    }
    if (/^cls\s*$/i.test(tokens[tokens.length - 1]) && tokens.length === 1) continue;
    commands.push(line);
  }
  return { mounts, commands };
}

/** Pre-made DOSBox bundles: a launcher .bat passing -conf files, or a dosbox.conf next to the game. */
function detectDosboxBundle(dir, entries) {
  const confFiles = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.bat$/i.test(e.name)) continue;
    const text = readText(path.join(dir, e.name));
    if (!/dosbox/i.test(text)) continue;
    const re = /-conf\s+"([^"]+)"|-conf\s+(\S+)/gi;
    let m;
    while ((m = re.exec(text))) confFiles.push(resolveDosPath(dir, m[1] || m[2]));
  }
  if (confFiles.length === 0) {
    const local = entries.find((e) => e.isFile() && /^dosbox.*\.conf$/i.test(e.name));
    if (local) confFiles.push(path.join(dir, local.name));
  }
  if (confFiles.length === 0) return null;

  let autoexec = [];
  let hints = {};
  for (const conf of confFiles) {
    const text = readText(conf);
    if (!text) continue;
    autoexec = autoexec.concat(extractAutoexec(text));
    hints = { ...hints, ...parseBundleHints(text) };
  }
  const parsed = parseAutoexec(autoexec, dir);
  if (parsed.mounts.length === 0) return null;
  return { ...parsed, hints, confFiles };
}

/** ScummVM bundles ship a scummvm.exe + ini, or just SCUMM data files. */
function detectScummvm(dir, entries) {
  for (const e of entries) {
    if (!e.isFile() || !/\.bat$/i.test(e.name)) continue;
    const text = readText(path.join(dir, e.name));
    const line = text.split(/\r?\n/).find((l) => /scummvm(\.exe)?["\s]/i.test(l) && !/^\s*echo/i.test(l));
    if (!line) continue;
    const tokens = tokenize(line.trim());
    const target = tokens[tokens.length - 1];
    const iniIdx = tokens.findIndex((t) => t === '-c' || t === '--config');
    let dataPath = null;
    let gameId = target;
    if (iniIdx >= 0 && tokens[iniIdx + 1]) {
      const ini = readText(resolveDosPath(dir, tokens[iniIdx + 1])).replace(/\r/g, '');
      const sec = ini.split(/\n(?=\[)/).find((s) => s.startsWith(`[${target}]`));
      if (sec) {
        const p = sec.match(/^path=(.*)$/m);
        if (p) dataPath = resolveDosPath(dir, p[1].trim());
        const g = sec.match(/^gameid=(.*)$/m);
        if (g) gameId = g[1].trim();
      }
    }
    if (!dataPath) {
      const sub = entries.find((x) => x.isDirectory() && x.name.toLowerCase() === target.toLowerCase());
      dataPath = sub ? path.join(dir, sub.name) : dir;
    }
    return { gameId, target, dataPath };
  }
  // Bare SCUMM data, here or one level down.
  const candidates = [dir, ...entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name))];
  for (const cand of candidates) {
    const names = safeReaddir(cand).map((e) => e.name);
    if (names.some((n) => SCUMM_DATA.test(n)) && !names.some((n) => /\.(exe|com)$/i.test(n))) {
      return { gameId: null, target: null, dataPath: cand };
    }
  }
  return null;
}

function scoreExecutable(name, folderName) {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase();
  // "The Bard's Tale (1985)(Electronic Arts Inc)" → "bardstale": drop release tags and a leading article.
  const folder = folderName.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
  if (NON_GAME.test(base)) return -100;
  let score = 0;
  if (base === folder) score += 50;
  else if (folder.startsWith(base) || base.startsWith(folder)) score += 25;
  if (/^(sierra|start|run|play|go|game|runme)$/.test(base)) score += 20;
  if (/\.bat$/i.test(name)) score += 5;
  if (/\.exe$/i.test(name)) score += 3;
  return score;
}

function rankExecutables(entries, folderName) {
  return entries
    .filter((e) => e.isFile() && RUNNABLE_EXT.test(e.name))
    .map((e) => ({ name: e.name, score: scoreExecutable(e.name, folderName) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((x) => x.name);
}

/** Build mounts/commands to run `exe` inside a plain DOS install. */
function buildRawLaunch({ dir, root, exe, cdImages }) {
  const name = path.basename(dir);
  const mounts = [];
  const commands = ['C:'];
  // Mount the library root as C: when we can, so games installed as C:\NAME find their files.
  if (root && path.dirname(dir) === path.resolve(root) && isDos83(name)) {
    mounts.push({ drive: 'C', path: path.resolve(root), kind: 'dir' });
    commands.push(`cd \\${name.toUpperCase()}`);
  } else {
    mounts.push({ drive: 'C', path: dir, kind: 'dir' });
  }
  if (cdImages && cdImages.length) mounts.push({ drive: 'D', path: cdImages[0], kind: 'image' });
  if (exe) commands.push(/\.bat$/i.test(exe) ? `call ${exe.toUpperCase()}` : exe.toUpperCase().replace(/\.(exe|com)$/i, ''));
  return { mounts, commands };
}

function collectImages(dir, limit = 24) {
  const out = [];
  for (const sub of ['screenshots', 'screens', 'captures']) {
    for (const e of safeReaddir(path.join(dir, sub))) {
      if (e.isFile() && IMAGE_EXT.test(e.name)) out.push(path.join(dir, sub, e.name));
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Scan one game folder. Returns null for folders that don't look like a game. */
function scanGameFolder(dir, root) {
  const entries = safeReaddir(dir);
  if (entries.length === 0) return null;
  const folderName = path.basename(dir);
  const lowerFiles = new Set(entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase()));
  const known = matchKnownGame(folderName, lowerFiles);

  const base = {
    id: gameId(dir),
    folder: dir,
    folderName,
    libraryRoot: root ? path.resolve(root) : path.dirname(dir),
    knownKey: known ? known.key : null,
    title: known ? known.title : prettifyName(folderName),
    wiki: known ? known.wiki : null,
    // Identifies the right release when matching box art; the shown year comes from metadata.
    year: known ? known.year : null,
    hasExtender: EXTENDERS.some((f) => lowerFiles.has(f)),
    localScreenshots: collectImages(dir),
    executables: rankExecutables(entries, folderName),
  };

  const scumm = detectScummvm(dir, entries);
  if (scumm) {
    return { ...base, engine: 'scummvm', launch: { scummvm: scumm } };
  }

  const bundle = detectDosboxBundle(dir, entries);
  if (bundle) {
    return {
      ...base,
      engine: 'dosbox',
      source: 'bundle',
      bundleHints: bundle.hints,
      launch: { dos: { mounts: bundle.mounts, commands: bundle.commands } },
    };
  }

  if (base.executables.length === 0) return null;
  const cdImages = entries.filter((e) => e.isFile() && CD_IMAGE_EXT.test(e.name)).map((e) => path.join(dir, e.name));
  // Prefer the curated executable when present (case-insensitively).
  const knownExe = known && known.exe && base.executables.find((n) => n.toLowerCase() === known.exe.toLowerCase());
  const exe = knownExe || base.executables[0];
  return {
    ...base,
    engine: 'dosbox',
    source: 'raw',
    exe,
    cdImages,
    launch: { dos: buildRawLaunch({ dir, root, exe, cdImages }) },
  };
}

/** Scan every immediate subfolder of `root`, except the folders listed in `skip`. */
function scanLibrary(root, { skip = [] } = {}) {
  const skipped = new Set(skip.map((p) => path.resolve(p)));
  const games = [];
  for (const e of safeReaddir(root)) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    if (skipped.has(path.resolve(root, e.name))) continue;
    // Skip non-game projects kept alongside the games, such as RetroShelf's own source.
    if (fs.existsSync(path.join(root, e.name, 'package.json'))) continue;
    const g = scanGameFolder(path.join(root, e.name), root);
    if (g) games.push(g);
  }
  return games;
}

module.exports = {
  scanLibrary,
  scanGameFolder,
  buildRawLaunch,
  parseAutoexec,
  extractAutoexec,
  rankExecutables,
  isDos83,
  prettifyName,
  tokenize,
};
