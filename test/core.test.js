'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseAutoexec, extractAutoexec, rankExecutables, isDos83, scanGameFolder, buildRawLaunch } = require('../src/main/scanner');
const { generateDosboxConfig, resolveProfile, guessEra, parseBundleHints } = require('../src/main/dosboxConfig');
const yazl = require('yazl');
const { parseGamePage, isBrowserCheck } = require('../src/main/abandonware');
const { isFiller } = require('../src/main/metadata');
const { sameGame, mentionsGame } = require('../src/main/match');
const { pickPage } = require('../src/main/wikipedia');
const { cleanDescription, pickGame: archivePickGame, pickGuides, pickPdf } = require('../src/main/archive');
const { extractGames, pickGame: launchboxPickGame } = require('../src/main/launchbox');
const { parseUhsIndex, pickUhs, pickStrategyWiki, localHints } = require('../src/main/hints');
const { politeFetch, RateLimitError, isHalted } = require('../src/main/http');
const { buildIndex, bestMatch, imagesFor } = require('../src/main/libretro');
const { saveUserImage, listUserShots, removeUserImage } = require('../src/main/userMedia');
const { matchKnownGame } = require('../src/main/knownGames');
const { Store } = require('../src/main/store');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'retroshelf-test-'));
}

test('parseAutoexec drops wrapper noise and resolves mounts relative to the bundle', () => {
  const conf = '[sdl]\nfullscreen=true\n[autoexec]\n@echo off\nmount C ".\\blood_res"\nMOUNT E ".\\D" -t cdrom\ncls\necho hi\npause\nc:\n:label\nblood\n';
  const parsed = parseAutoexec(extractAutoexec(conf), '/games/Blood');
  assert.deepStrictEqual(parsed.mounts, [
    { drive: 'C', path: path.resolve('/games/Blood/blood_res'), kind: 'dir' },
    { drive: 'E', path: path.resolve('/games/Blood/D'), kind: 'cdrom' },
  ]);
  assert.deepStrictEqual(parsed.commands, ['c:', 'blood']);
});

test('rankExecutables puts installers last and folder-named exes first', () => {
  const entries = ['INSTALL.EXE', 'SETUP.EXE', 'DOOM.EXE', 'DEICE.EXE', 'readme.exe'].map((name) => ({ name, isFile: () => true }));
  assert.strictEqual(rankExecutables(entries, 'Doom')[0], 'DOOM.EXE');
});

test('rankExecutables matches the game exe against a folder name with an article and release tags', () => {
  const entries = ['copychar.bat', 'install.bat', 'bard.exe', 'btedit.exe', 'setup.exe'].map((name) => ({ name, isFile: () => true }));
  assert.strictEqual(rankExecutables(entries, "The Bard's Tale (1985)(Electronic Arts Inc)")[0], 'bard.exe');
});

test('isDos83 accepts short names and rejects long or spaced ones', () => {
  assert.ok(isDos83('WOLF3D'));
  assert.ok(!isDos83('CnC Red Alert'));
  assert.ok(!isDos83('DukeNukem3D'));
});

test('buildRawLaunch mounts the library root for 8.3 folders and the folder itself otherwise', () => {
  const a = buildRawLaunch({ dir: '/lib/DOOM', root: '/lib', exe: 'DOOM.EXE', cdImages: [] });
  assert.strictEqual(a.mounts[0].path, path.resolve('/lib'));
  assert.deepStrictEqual(a.commands, ['C:', 'cd \\DOOM', 'DOOM']);
  const b = buildRawLaunch({ dir: '/lib/Long Name Game', root: '/lib', exe: 'go.bat', cdImages: ['/lib/Long Name Game/cd.iso'] });
  assert.strictEqual(b.mounts[0].path, '/lib/Long Name Game');
  assert.deepStrictEqual(b.mounts[1], { drive: 'D', path: '/lib/Long Name Game/cd.iso', kind: 'image' });
  assert.deepStrictEqual(b.commands, ['C:', 'call GO.BAT']);
});

test('scanGameFolder detects ScummVM bundles from the launcher bat and ini', () => {
  const root = tmpdir();
  const dir = path.join(root, 'DayTentacle');
  fs.mkdirSync(path.join(dir, 'scummvm'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tentacle'));
  fs.writeFileSync(path.join(dir, 'tentacle', 'TENTACLE.000'), 'x');
  fs.writeFileSync(path.join(dir, 'DayTentacle.bat'), '@echo off\r\necho. Thanks to ScummMV\r\n.\\scummvm\\scummvm.exe -c .\\scummvm\\scumm.ini tentacle\r\n');
  fs.writeFileSync(path.join(dir, 'scummvm', 'scumm.ini'), '[scummvm]\r\nfullscreen=true\r\n[tentacle]\r\ngameid=tentacle\r\npath=.\\tentacle\\\r\n');
  const g = scanGameFolder(dir, root);
  assert.strictEqual(g.engine, 'scummvm');
  assert.strictEqual(g.launch.scummvm.gameId, 'tentacle');
  assert.strictEqual(g.launch.scummvm.dataPath, path.join(dir, 'tentacle'));
  assert.strictEqual(g.knownKey, 'day-of-the-tentacle');
});

test('scanGameFolder uses the curated exe for known games', () => {
  const root = tmpdir();
  const dir = path.join(root, 'kq4');
  fs.mkdirSync(dir);
  for (const f of ['INSTALL.EXE', 'SIERRA.COM', 'SCIV.EXE', 'KQ4.BAT', 'EXISTS.COM']) fs.writeFileSync(path.join(dir, f), 'x');
  const g = scanGameFolder(dir, root);
  assert.strictEqual(g.source, 'raw');
  assert.strictEqual(g.exe, 'SIERRA.COM');
  assert.deepStrictEqual(g.launch.dos.commands, ['C:', 'cd \\KQ4', 'SIERRA']);
});

test('scanGameFolder matches curated entries by exact folder name, not shared interpreter files', () => {
  const root = tmpdir();
  const dir = path.join(root, 'Laura Bow 2 (1993)(Sierra On-Line)');
  fs.mkdirSync(dir);
  for (const f of ['SCIDHUV.EXE', 'SIERRA.EXE', 'RESOURCE.MAP']) fs.writeFileSync(path.join(dir, f), 'x');
  const g = scanGameFolder(dir, root);
  assert.strictEqual(g.knownKey, 'laura-bow-2');
  assert.strictEqual(g.title, 'The Dagger of Amon Ra');
});

test('guessEra maps a release year to an era, bumped by a DOS extender', () => {
  assert.strictEqual(guessEra({ year: 1986 }), 'xt');
  assert.strictEqual(guessEra({ year: 1991 }), '386');
  assert.strictEqual(guessEra({ year: 1991, extended: true }), '486');
  assert.strictEqual(guessEra({ year: 1996 }), 'pentium');
  assert.strictEqual(guessEra({ year: NaN }), null);
});

test('parseBundleHints reads tuned cycles and memsize', () => {
  assert.deepStrictEqual(parseBundleHints('cycles=15000\r\nmemsize=16\r\n'), { cycles: 15000, memsize: 16 });
  assert.deepStrictEqual(parseBundleHints('cycles=auto\n'), {});
  assert.deepStrictEqual(parseBundleHints('cycles=fixed 9000\n'), { cycles: 9000 });
});

test('resolveProfile layers era < known tune < user overrides', () => {
  const known = matchKnownGame('wc2', new Set());
  const game = { known, knownKey: known.key, overrides: { memsize: 12 } };
  const p = resolveProfile(game, { shader: 'sharp' });
  assert.strictEqual(p.era, '386');
  assert.strictEqual(p.cycles, 8000);
  assert.strictEqual(p.memsize, 12);
  assert.strictEqual(p.shader, 'sharp');
});

test('resolveProfile takes an uncurated game\'s era from its release year', () => {
  const p = resolveProfile({ releaseYear: 1996 }, {});
  assert.strictEqual(p.era, 'pentium');
  assert.strictEqual(p.cyclesProtected, 'max');
  const extended = resolveProfile({ releaseYear: 1992, hasExtender: true }, {});
  assert.strictEqual(extended.era, '486');
});

test('a game with no release year and no curated era has no profile and cannot be configured', () => {
  assert.strictEqual(resolveProfile({}, {}), null);
  const game = { title: 'Mystery Game', launch: { dos: { mounts: [], commands: [] } } };
  assert.throws(() => generateDosboxConfig(game, {}, { platform: 'darwin' }), /Mystery Game: release year required/);
  // A user-picked era still yields a profile, but launching is blocked until the year is set.
  assert.strictEqual(resolveProfile({ overrides: { era: '386' } }, {}).era, '386');
});

test('resolveProfile: a user-picked era replaces curated speed but keeps other curated tuning', () => {
  const known = matchKnownGame('lemmings', new Set());
  const game = { known, knownKey: known.key, overrides: { era: '486' } };
  const p = resolveProfile(game, {});
  assert.strictEqual(p.era, '486');
  assert.strictEqual(p.cycles, 25000);
  assert.strictEqual(p.core, 'auto');
  assert.strictEqual(p.mouse, 'seamless');
});

test('generateDosboxConfig writes Staging keys and an autoexec that exits', () => {
  const game = {
    title: 'Doom',
    known: matchKnownGame('doom', new Set()),
    knownKey: 'doom',
    launch: { dos: { mounts: [{ drive: 'C', path: '/lib', kind: 'dir' }], commands: ['C:', 'cd \\DOOM', 'DOOM'] } },
  };
  const conf = generateDosboxConfig(game, { fullscreen: true }, { platform: 'darwin', captureDir: '/cap' });
  assert.match(conf, /cpu_cycles = 25000/);
  assert.match(conf, /cpu_cycles_protected = 50000/);
  assert.match(conf, /glshader = crt-auto/);
  assert.match(conf, /mididevice = coreaudio/);
  assert.match(conf, /capture_dir = \/cap/);
  assert.match(conf, /\[autoexec\]\n@echo off\nmount C "\/lib"\nC:\ncd \\DOOM\nDOOM\nexit/);
});

test('generateDosboxConfig prefers a SoundFont and only uses MT-32 when asked and available', () => {
  const game = { title: 'x', releaseYear: 1991, launch: { dos: { mounts: [], commands: [] } }, overrides: { midi: 'mt32' } };
  const withRoms = generateDosboxConfig(game, {}, { platform: 'linux', mt32RomDir: '/roms' });
  assert.match(withRoms, /mididevice = mt32/);
  const noRoms = generateDosboxConfig(game, {}, { platform: 'linux', soundfont: '/sf/gm.sf2' });
  assert.match(noRoms, /mididevice = fluidsynth/);
  assert.match(noRoms, /soundfont = \/sf\/gm.sf2/);
});

const GAME_HTML = `<html><head><title>Download Space Hulk - My Abandonware</title></head><body>
<div class="box">

    <h2>Space Hulk</h2>
</div>
<table class="gameInfo"><tbody>
<tr>
<th scope="row">Year</th>
<td><a href="/browse/year/1993/">1993</a></td>
</tr>
<tr>
<th scope="row">Genre</th>
<td><a class='gel' href='/browse/genre/strategy/'>Strategy</a></td>
</tr>
<tr>
<th scope="row">Developer</th>
<td><a href='/x'>Electronic Arts</a></td>
</tr>
</tbody></table>
<div class="gameDescription dscr">
<p>Marines &amp; Genestealers.</p>
<p><span class="revhotud">Review By HOTUD</span></p>
</div>
<ul id="screentabs"><li><a href="javascript:void(0)" data-platform="5" onclick="t(this)">Amiga</a></li><li><a href="javascript:void(0)" data-platform="1" onclick="t(this)" class="current">DOS</a></li><div class="items screens" data-platform="5"><a class="item itemListScreenshot thumb c-thumb lb"
    href="/media/screenshots/s/amiga_1.png" data-webp="0"></a><div class="item filler"></div></div><div class="items screens" data-platform="1"><a class="item itemListScreenshot thumb c-thumb lb"
    href="/media/screenshots/s/dos_1.png" data-webp="0"></a><a class="item itemListScreenshot thumb c-thumb lb"
    href="/media/screenshots/s/dos_2.png" data-webp="0"></a><div class="item filler"></div></div>
<script type="application/ld+json">{"@type":"VideoGame","name":"Space Hulk","publisher":["Electronic Arts"],"aggregateRating":{"ratingValue":"4.5","ratingCount":"10"}}</script>
</body></html>`;

test('parseGamePage reads info table, description and DOS-only screenshots', () => {
  const g = parseGamePage(GAME_HTML, 'https://www.myabandonware.com/game/space-hulk-x');
  assert.strictEqual(g.title, 'Space Hulk');
  assert.strictEqual(g.year, 1993);
  assert.strictEqual(g.genre, 'Strategy');
  assert.strictEqual(g.developer, 'Electronic Arts');
  assert.strictEqual(g.publisher, 'Electronic Arts');
  assert.strictEqual(g.description, 'Marines & Genestealers.');
  assert.deepStrictEqual(g.screenshotUrls.map((s) => s.url), [
    'https://www.myabandonware.com/media/screenshots/s/dos_1.png',
    'https://www.myabandonware.com/media/screenshots/s/dos_2.png',
  ]);
  assert.strictEqual(g.rating, '4.5/5 (10 votes)');
});

test('parseGamePage reads the current "Description of" markup and flags the generated blurb', () => {
  const html = '<div class="box"><h3>Description of Caesar II</h3><p>Caesar II, a really nice game, is available and ready to be played again!</p><h4>External links</h4></div>';
  const g = parseGamePage(html, 'https://www.myabandonware.com/game/caesar-ii-2at');
  assert.match(g.description, /^Caesar II, a really nice game/);
  assert.ok(isFiller(g.description));
  assert.ok(!isFiller('Build Rome, one province at a time.'));
  assert.ok(isBrowserCheck('<title>Please wait…</title>'));
});

test('sameGame allows subtitles but not sequels; mentionsGame finds the title inside a book name', () => {
  assert.ok(sameGame('Blood (video game)', 'Blood'));
  assert.ok(sameGame('Laura Bow 2: The Dagger of Amon Ra', 'Laura Bow 2'));
  assert.ok(!sameGame('Doom II', 'Doom'));
  assert.ok(!sameGame('Captain Blood (1988 video game)', 'Blood'));
  assert.ok(mentionsGame('DOOM II Official Strategy Guide', 'Doom II'));
  assert.ok(!mentionsGame('DOOM II Official Strategy Guide', 'Doom'));
  assert.ok(!mentionsGame('Phantasy Star III Generations Of Doom Hint Book', 'Doom 2'));
});

test('Wikipedia picks the game article for the title and year, skipping series and other games', () => {
  const pages = [
    { index: 1, title: 'Blood (franchise)', description: 'video game series', extract: 'A series.' },
    { index: 2, title: 'Captain Blood (1988 video game)', description: '1988 video game', extract: 'Captain Blood is…' },
    { index: 3, title: 'Blood (video game)', description: '1997 video game', extract: 'Blood is a 1997 first-person shooter.' },
  ];
  const hit = pickPage(pages, 'Blood', 1997);
  assert.strictEqual(hit.description, 'Blood is a 1997 first-person shooter.');
  assert.strictEqual(hit.url, 'https://en.wikipedia.org/wiki/Blood_(video_game)');
  assert.strictEqual(pickPage(pages, 'Blood', 2004), null);
});

test('Internet Archive descriptions drop MobyGames credit headers and upload notes', () => {
  const raw = 'Mindscape, Inc. Developed by Angelsoft Published by Mindscape Released 1985 Genre Adventure Description Free the prisoners. From Mobygames.com. Original Entry';
  assert.strictEqual(cleanDescription(raw), 'Free the prisoners.');
  assert.strictEqual(cleanDescription('This is version v1.11 of Blood (Shareware).'), '');
  const docs = [
    { identifier: 'blood-alt', title: 'Blood (Shareware) (Alt-Controls)', year: 1997, description: 'This is version v1.11 of Blood.' },
    { identifier: 'msdos_Blood_1997', title: 'Blood', year: 1997, description: '<p>Caleb rises.</p>' },
  ];
  assert.deepStrictEqual(archivePickGame(docs, 'Blood', 1997), { description: 'Caleb rises.', year: 1997, url: 'https://archive.org/details/msdos_Blood_1997' });
});

test('Internet Archive guides must name the game and read like a guide; PDFs skip lending-only files', () => {
  const docs = [
    { identifier: 'a', title: 'DOOM II Official Strategy Guide' },
    { identifier: 'b', title: 'Doom 1 Hintbook and Manual' },
    { identifier: 'c', title: 'The Doom loop system : a step-by-step guide' },
    { identifier: 'd', title: 'Doom Installation Guide' },
  ];
  assert.deepStrictEqual(pickGuides(docs, 'Doom II').map((d) => d.identifier), ['a']);
  assert.strictEqual(pickPdf([{ name: 'book.pdf', private: 'true' }, { name: 'scan/book_text.pdf' }]), 'scan/book_text.pdf');
  assert.strictEqual(pickPdf([{ name: 'book.epub' }]), null);
});

/** Write a zip holding the given files, as LaunchBox ships Metadata.zip. */
function writeZip(file, entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    for (const [name, text] of Object.entries(entries)) zip.addBuffer(Buffer.from(text), name);
    zip.end();
    zip.outputStream.pipe(fs.createWriteStream(file)).on('close', resolve).on('error', reject);
  });
}

test('LaunchBox index keeps only MS-DOS games and matches by title and year', async () => {
  const xml = '<?xml version="1.0" standalone="yes"?><LaunchBox>'
    + '<Game><Name>Blood</Name><ReleaseYear>1997</ReleaseYear><Overview>Caleb &amp; friends.</Overview><Platform>MS-DOS</Platform><Developer>Monolith</Developer><Genres>Shooter; Horror</Genres><DatabaseID>42</DatabaseID></Game>'
    + '<Game><Name>Blood</Name><ReleaseYear>2004</ReleaseYear><Overview>Another.</Overview><Platform>Sony Playstation 2</Platform></Game>'
    + '<GameImage><DatabaseID>42</DatabaseID><Type>Box - Front</Type></GameImage>'
    + '</LaunchBox>';
  const zipFile = path.join(tmpdir(), 'Metadata.zip');
  await writeZip(zipFile, { 'Mame.xml': '<x/>', 'Metadata.xml': xml });
  const games = await extractGames(zipFile);
  assert.strictEqual(games.length, 1);
  const hit = launchboxPickGame(games, 'Blood', 1997);
  assert.strictEqual(hit.description, 'Caleb & friends.');
  assert.strictEqual(hit.genre, 'Shooter, Horror');
  assert.strictEqual(hit.url, 'https://gamesdb.launchbox-app.com/games/details/42');
  assert.strictEqual(launchboxPickGame(games, 'Blood', 2004), null);
});

test('hint sources: UHS index, StrategyWiki walkthrough pages and hint files in the game folder', () => {
  const uhs = parseUhsIndex('<ul><li><div class="hint-title-group"><span class="hint-title">King&#039;s Quest V</span><span class="hint-author">x</span></div><div class="hint-links"><a href="/uhsweb/kq5">View Hints</a></div></li>'
    + '<li><div class="hint-title-group"><span class="hint-title">King&#039;s Quest VI</span></div><div class="hint-links"><a href="/uhsweb/kq6">View Hints</a></div></li>'
    + '<li><a href="/hints/">Hints</a></li></ul>');
  assert.strictEqual(uhs.length, 2);
  assert.deepStrictEqual(pickUhs(uhs, "King's Quest 5").map((h) => h.url), ['https://www.uhs-hints.com/uhsweb/kq5']);
  const sw = pickStrategyWiki(['Doom', 'Doom/Walkthrough', 'Doom II', 'Doom 64/Walkthrough'], 'DOOM');
  assert.deepStrictEqual(sw.map((h) => h.url), ['https://strategywiki.org/wiki/Doom/Walkthrough']);
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, 'DOCS'));
  fs.writeFileSync(path.join(dir, 'DOCS', 'Hintbook.pdf'), '');
  fs.writeFileSync(path.join(dir, 'GAME.EXE'), '');
  fs.writeFileSync(path.join(dir, 'readme.txt'), '');
  assert.deepStrictEqual(localHints(dir).map((h) => h.label), [path.join('DOCS', 'Hintbook.pdf')]);
});

test('libretro matching handles subtitles, implied "I", articles, sequels and variants', () => {
  const names = [
    'Laura Bow 1_ The Colonel\'s Bequest', 'MOT (1989)', 'Quest for Glory I_ So You Want to be a Hero', 'Quest, The',
    'Wing Commander', 'Wing Commander II_ Vengeance of the Kilrathi', 'Oregon Trail Deluxe, The', 'DOOM (1993)', 'Doom', 'Lemmings (Demo)', 'Lemmings',
  ];
  const tree = { tree: [
    ...names.map((n) => ({ path: `Named_Boxarts/${n}.png` })),
    { path: 'Named_Snaps/Doom.png' },
  ] };
  const index = buildIndex(tree);
  assert.strictEqual(bestMatch(index, "The Colonel's Bequest", 1989), "Laura Bow 1_ The Colonel's Bequest");
  assert.strictEqual(bestMatch(index, 'Quest for Glory: So You Want to Be a Hero', 1992), 'Quest for Glory I_ So You Want to be a Hero');
  assert.strictEqual(bestMatch(index, 'Wing Commander II: Vengeance of the Kilrathi', 1991), 'Wing Commander II_ Vengeance of the Kilrathi');
  assert.strictEqual(bestMatch(index, 'The Oregon Trail Deluxe', 1992), 'Oregon Trail Deluxe, The');
  assert.strictEqual(bestMatch(index, 'Lemmings', 1991), 'Lemmings');
  assert.strictEqual(bestMatch(index, 'Completely Unknown Game', null), null);
  const doom = bestMatch(index, 'Doom', 1993);
  assert.strictEqual(doom, 'DOOM (1993)');
  assert.match(imagesFor(index, doom).snap, /Named_Snaps\/Doom\.png$/);
});

test('politeFetch halts a host on 429 and never calls it again', async () => {
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { status: 429, ok: false }; };
  try {
    await assert.rejects(politeFetch('https://ratelimited.test/a'), RateLimitError);
    await assert.rejects(politeFetch('https://ratelimited.test/b'), RateLimitError);
    assert.strictEqual(calls, 1);
    assert.ok(isHalted('https://ratelimited.test/c'));
  } finally {
    global.fetch = realFetch;
  }
});

test('Store.mergeScan keeps user data across rescans and marks vanished games missing', () => {
  const dir = tmpdir();
  const store = new Store(dir);
  const root = path.resolve('/lib');
  store.mergeScan([{ id: 'a', title: 'A', libraryRoot: root }, { id: 'b', title: 'B', libraryRoot: root }], [root]);
  store.updateGame('a', { favorite: true, playtimeSec: 60 });
  const added = store.mergeScan([{ id: 'a', title: 'A2', libraryRoot: root }], [root]);
  assert.deepStrictEqual(added, []);
  assert.strictEqual(store.game('a').favorite, true);
  assert.strictEqual(store.game('a').title, 'A2');
  assert.strictEqual(store.game('b').missing, true);
  const reloaded = new Store(dir);
  assert.strictEqual(reloaded.game('a').playtimeSec, 60);
});

test('user images: only image files are saved, screenshots list in upload order, removal stays inside the folder', () => {
  const media = tmpdir();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  assert.throws(() => saveUserImage(media, 'g1', { name: 'evil.exe', data: png }, 'shot'), /image/);
  assert.throws(() => saveUserImage(media, 'g1', { name: 'huge.png', data: Buffer.alloc(21 * 1024 * 1024) }, 'shot'), /20 MB/);
  const a = saveUserImage(media, 'g1', { name: 'first.PNG', data: png }, 'shot');
  const b = saveUserImage(media, 'g1', { name: 'second.jpg', data: png }, 'shot');
  const cover = saveUserImage(media, 'g1', { name: 'box.webp', data: png }, 'cover');
  assert.match(a, /^shot-.*\.png$/);
  assert.match(cover, /^cover-.*\.webp$/);
  assert.deepStrictEqual(listUserShots(media, 'g1').map((f) => path.basename(f)), [a, b]);
  // A path-like name can't reach outside the game's folder.
  const outside = path.join(media, 'keep.png');
  fs.writeFileSync(outside, png);
  removeUserImage(media, 'g1', '../../keep.png');
  assert.ok(fs.existsSync(outside));
  removeUserImage(media, 'g1', a);
  assert.deepStrictEqual(listUserShots(media, 'g1').map((f) => path.basename(f)), [b]);
});
