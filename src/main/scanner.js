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
const NON_GAME = /^(install|winstall|_install|setup|setsound|setmuse|config|configur|sound|detect|detectcd|autodet|deice|catalog|readme|help|info|uninst|uvconfig|dos4gw|dos32a|32rtm|pmodew|cwsdpmi|dpmi|rtm|exists|godir|space|choice|pkunz|pkunzjr|cleardrv|bootdisk|emuset|instgame|__insth|drv_.*|.*ed95|.*edit|.*cht|.*crack|rkernel|centerjs|load)$/i;
// Programs bundled with a game that are useful but are not the game itself.
const AUXILIARY = /^(demo|intro|trainer|cheat|nosound|save|feed|patch|update|unpack|extract|dearj|pkunpak|pkunzip|pkzip|arj|unzip|lha|stmopn\w*|snoop\w*|order|register|credits|thanks|test|diag|checksys|sfx)$/i;
// Batch files whose job is to start the Windows build of an emulator (or cmd.exe),
// not a DOS program. Running one inside DOSBox always fails.
const HOST_LAUNCHER = /\b(?:dosbox(?:-staging)?|scummvm)(?:\.exe)?\b|%~?dp0\b|%cd%|\bcmd(?:\.exe)?\b|\bstart\s+(?:""\s+)?(?:[A-Za-z]:|%|\/)|\bcd\s+\/[dD]\b/i;
// Generic entry-point names: plausible, but weaker than a name that matches the title.
const LAUNCHER_NAME = /^(start|run|play|go|game|runme|launch)$/i;
// Common names for a game's real main program.
const MAIN_NAME = /^(main|game)$/i;
const TITLE_STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'for', 'with']);
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

/** DOSBox commands passed with -c on one launcher line. */
function inlineCommands(line) {
  const out = [];
  let found = false;
  const quoted = /-c\s+"([^"]*)"/gi;
  let m;
  while ((m = quoted.exec(line))) {
    out.push(m[1]);
    found = true;
  }
  if (found) return out;
  const bare = /-c\s+(.+?)(?=\s+-[a-zA-Z]|$)/gi;
  while ((m = bare.exec(line))) {
    const cmd = m[1].trim().replace(/^"|"$/g, '');
    if (cmd) out.push(cmd);
  }
  return out;
}

/**
 * Find each DOSBox launch in a Windows wrapper and the working directory in effect.
 * GOG/eXoDOS-style launchers often `cd DOSBOX` first, so their relative `-conf`,
 * `-c` and `mount` paths are relative to that subfolder, not the game folder.
 */
function dosboxRuns(dir, text) {
  const runs = [];
  let cwd = dir;
  // Windows cmd expands these before DOSBox sees them.
  const expand = (s) => s.replace(/%~dp0/gi, `${dir}${path.sep}`).replace(/%cd%/gi, cwd);
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^(rem|::|#)/i.test(line)) continue;
    const cd = line.match(/^@?(?:cd|chdir)\s+(?:\/d\s+)?("?)([^"&|]+)\1/i);
    if (cd) {
      const target = expand(cd[2].trim());
      if (target && !target.includes('%')) cwd = path.resolve(cwd, target.replace(/\\/g, '/'));
      continue;
    }
    if (!/dosbox/i.test(line)) continue;
    const confFiles = [];
    const re = /-conf\s+"([^"]+)"|-conf\s+(\S+)/gi;
    let m;
    while ((m = re.exec(line))) confFiles.push(resolveDosPath(cwd, expand(m[1] || m[2])));
    runs.push({ base: cwd, confFiles, inline: inlineCommands(line).map(expand) });
  }
  return runs;
}

/** Merge mount lists, letting the packaged config's mount win for a drive both define. */
function mergeMounts(primary, extra) {
  const byDrive = new Map();
  for (const m of [...primary, ...extra]) if (!byDrive.has(m.drive)) byDrive.set(m.drive, m);
  return [...byDrive.values()];
}

function mergeCommands(primary, extra) {
  const seen = new Set(primary);
  return [...primary, ...extra.filter((c) => !seen.has(c) && (seen.add(c), true))];
}

/** True when an autoexec actually starts something, not just mounts drives. */
function hasLaunchCommand(commands) {
  return commands.some((c) => {
    const line = c.trim().toLowerCase();
    return line && !/^(?:@?echo|cls|pause|rem|exit|set|path|[a-z]:)$/.test(line) && !/^(?:mount|imgmount)\b/.test(line);
  });
}

/** Pre-made DOSBox bundles: a launcher .bat passing -conf/-c, or a dosbox.conf next to the game. */
function detectDosboxBundle(dir, entries) {
  let runs = [];
  const confFiles = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.(?:bat|cmd)$/i.test(e.name)) continue;
    const text = readText(path.join(dir, e.name));
    if (!/dosbox/i.test(text)) continue;
    runs.push(...dosboxRuns(dir, text));
  }
  // A bare dosbox.conf next to the game (or next to the wrapper's cd target) is used
  // only when no launcher supplies a config or inline commands.
  if (!runs.some((r) => r.confFiles.length || r.inline.length)) {
    for (const base of new Set([dir, ...runs.map((r) => r.base)])) {
      const local = safeReaddir(base).find((e) => e.isFile() && /^dosbox.*\.conf$/i.test(e.name));
      if (local) runs.push({ base, confFiles: [path.join(base, local.name)], inline: [] });
    }
  }
  if (!runs.some((r) => r.confFiles.length || r.inline.length)) return null;

  let hints = {};
  let mounts = [];
  let commands = [];
  for (const run of runs) {
    let confAutoexec = [];
    for (const conf of run.confFiles) {
      const text = readText(conf);
      if (!text) continue;
      confFiles.push(conf);
      confAutoexec = confAutoexec.concat(extractAutoexec(text));
      hints = { ...hints, ...parseBundleHints(text) };
    }
    const fromConf = parseAutoexec(confAutoexec, run.base);
    const fromInline = parseAutoexec(run.inline, run.base);
    mounts = mergeMounts(mounts, mergeMounts(fromConf.mounts, fromInline.mounts));
    // The packaged config is the authority when it already starts the game; inline -c
    // commands are the fallback for wrappers that keep everything on the command line.
    commands = mergeCommands(commands, fromConf.commands.length ? fromConf.commands : fromInline.commands);
  }
  if (mounts.length === 0) return null;
  return { mounts, commands, hints, confFiles };
}

/** ScummVM bundles ship a scummvm.exe + ini, or just SCUMM data files. */
function detectScummvm(dir, entries) {
  for (const e of entries) {
    if (!e.isFile() || !/\.(?:bat|cmd)$/i.test(e.name)) continue;
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

/** Words in a release folder name, used to spot an executable named after the game. */
function titleWords(folderName) {
  return folderName
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/^(the|a|an)\s+/i, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !TITLE_STOP_WORDS.has(w));
}

function scoreExecutable(name, folderName, { size = 0, hostLauncher = false } = {}) {
  const base = name.replace(/\.[^.]+$/, '').toLowerCase();
  if (NON_GAME.test(base)) return -100;
  if (hostLauncher) return -200;
  // "The Bard's Tale (1985)(Electronic Arts Inc)" → "bardstale": drop release tags and a leading article.
  const folder = folderName.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim().toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]/g, '');
  let score = 0;
  if (base === folder) score += 50;
  else {
    // An exe named after one word of the title ("monkey.exe" for Monkey Island) is a strong signal.
    if (base.length >= 4 && titleWords(folderName).includes(base)) score += 30;
    if (folder.startsWith(base) || base.startsWith(folder)) score += 20;
  }
  if (AUXILIARY.test(base)) score -= 40;
  if (MAIN_NAME.test(base)) score += 10;
  else if (LAUNCHER_NAME.test(base)) score += 8;
  if (/\.bat$/i.test(name)) score += 5;
  if (/\.exe$/i.test(name)) score += 3;
  // Game executables are usually larger than the small helper programs next to them.
  if (size > 0) score += Math.min(5, Math.floor(Math.log10(size + 1)));
  return score;
}

/** Program names invoked from a DOS batch file, so an auxiliary wrapper can point at the real exe. */
function invokedPrograms(text) {
  const out = new Set();
  const shell = new Set(['copy', 'del', 'delete', 'erase', 'md', 'mkdir', 'rd', 'rmdir', 'cd', 'chdir', 'set', 'if', 'goto', 'echo', 'rem', 'cls', 'pause', 'exit', 'ren', 'rename', 'type', 'path', 'loadhigh', 'lh', 'call', 'for', 'shift', 'ver', 'vol', 'date', 'time', 'break', 'choice', 'attrib', 'smartdrv', 'mem', 'mode', 'keyb', 'prompt', 'subst', 'join', 'fdisk', 'format', 'sys', 'do', 'else']);
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || /^[:#]/.test(line) || /^@?echo\b/i.test(line) || /^(cls|pause|rem)\b/i.test(line)) continue;
    const tokens = tokenize(line);
    if (!tokens.length) continue;
    let cmd = tokens[0].replace(/^@/, '');
    if (/^(call|lh|loadhigh)$/i.test(cmd) && tokens[1]) cmd = tokens[1];
    cmd = path.basename(cmd.replace(/\\/g, '/'));
    if (!cmd || cmd.startsWith('%')) continue;
    const base = cmd.replace(/\.[^.]+$/, '').toLowerCase();
    if (/^[a-z0-9]/.test(base) && !shell.has(base)) out.add(base);
  }
  return out;
}

/** Case-insensitive existence check for a DOS path, which may use any case. */
function existsDosPath(base, rel) {
  let cur = base;
  for (const part of rel.split('/').filter(Boolean)) {
    let entries;
    try {
      entries = fs.readdirSync(cur);
    } catch {
      return false;
    }
    const match = entries.find((n) => n.toLowerCase() === part.toLowerCase());
    if (!match) return false;
    cur = path.join(cur, match);
  }
  return true;
}

/** A batch that changes to an absolute DOS path that isn't in this game tree is for another install. */
function hasForeignCd(dir, text) {
  const targets = [...text.matchAll(/^\s*@?cd\s+"?\\([^"\r\n]+)"?/gim)]
    .map((m) => m[1].trim().replace(/\\/g, '/'))
    .filter(Boolean);
  if (!targets.length) return false;
  return !targets.some((t) => existsDosPath(dir, t) || existsDosPath(path.dirname(dir), t));
}

function fileSize(dir, name) {
  try {
    return fs.statSync(path.join(dir, name)).size;
  } catch {
    return 0;
  }
}

function rankExecutables(entries, folderName, dir) {
  const runnable = entries.filter((e) => e.isFile() && RUNNABLE_EXT.test(e.name));
  // A batch that starts a Windows emulator, or a tiny helper that launches another exe,
  // is not the game. Read batches when the folder is known.
  const hostLaunchers = new Set();
  const foreignBats = new Set();
  const launcherBats = new Set();
  const launched = new Set();
  if (dir) {
    for (const e of runnable) {
      if (!/\.bat$/i.test(e.name)) continue;
      const text = readText(path.join(dir, e.name));
      if (HOST_LAUNCHER.test(text)) {
        hostLaunchers.add(e.name);
        continue;
      }
      const base = e.name.replace(/\.[^.]+$/, '').toLowerCase();
      const programs = invokedPrograms(text);
      if (hasForeignCd(dir, text)) {
        foreignBats.add(e.name);
      } else if (AUXILIARY.test(base)) {
        // A helper batch (nosound.bat, trainer.bat) points at the program it set up for.
        for (const cmd of programs) launched.add(cmd);
      } else if (!NON_GAME.test(base) && programs.size > 0) {
        // A normal batch that runs the game is usually the intended entry point.
        launcherBats.add(e.name);
        if (LAUNCHER_NAME.test(base)) {
          // A generic START.BAT/runme.bat that only runs one game program is a wrapper:
          // launch the program directly instead of the wrapper. Batches with their own
          // branching are doing real setup, so keep them.
          const candidates = [...programs].filter((p) => !NON_GAME.test(p) && !AUXILIARY.test(p));
          if (candidates.length === 1 && !/\b(?:if|goto|errorlevel)\b/i.test(text)) {
            launched.add(candidates[0]);
            launcherBats.delete(e.name);
          }
        }
      }
    }
  }
  const scored = runnable.map((e) => {
    const name = e.name;
    const base = name.replace(/\.[^.]+$/, '').toLowerCase();
    let score = scoreExecutable(name, folderName, {
      size: dir ? fileSize(dir, name) : 0,
      hostLauncher: hostLaunchers.has(name),
    });
    if (foreignBats.has(name)) score -= 30;
    if (launcherBats.has(name)) score += 12;
    // Prefer the program a helper batch set up for (nosound.bat → s2.exe), not the helper.
    if (dir && launched.has(base) && !/\.bat$/i.test(name)) score += 25;
    return { name, score };
  });
  // Hide host launchers while a real DOS program exists; keep them only as a last resort.
  const preferred = scored.filter((x) => !hostLaunchers.has(x.name));
  const list = preferred.length ? preferred : scored;
  return list
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
    executables: rankExecutables(entries, folderName, dir),
  };

  const scumm = detectScummvm(dir, entries);
  if (scumm) {
    return { ...base, engine: 'scummvm', launch: { scummvm: scumm } };
  }

  const bundle = detectDosboxBundle(dir, entries);
  // A wrapper that only mounts a drive but never starts anything is not a launchable bundle.
  if (bundle && hasLaunchCommand(bundle.commands)) {
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
