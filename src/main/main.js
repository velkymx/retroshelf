'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, crashReporter, nativeTheme } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('electron-log/main');

// All app data lives in RetroShelf-data next to the app (the packaged .app's folder, or the
// source folder's parent when run from source), not in the OS profile, so the library, art,
// configs and logs stay with the games. Must be set before anything reads userData.
function appHome() {
  if (!app.isPackaged) return path.resolve(__dirname, '../../..');
  // macOS: <home>/RetroShelf.app/Contents/MacOS/RetroShelf; elsewhere: <home>/<app folder>/RetroShelf.exe
  return process.platform === 'darwin' ? path.resolve(app.getPath('exe'), '../../../..') : path.dirname(path.dirname(app.getPath('exe')));
}
const APP_HOME = appHome();
const DATA_DIR = path.join(APP_HOME, 'RetroShelf-data');
app.setPath('userData', DATA_DIR);
app.setPath('logs', path.join(DATA_DIR, 'logs'));
app.setPath('crashDumps', path.join(DATA_DIR, 'crashes'));

// Main-process and renderer logs (the renderer console included) go to RetroShelf-data/logs.
// Uncaught exceptions and unhandled rejections are logged there instead of vanishing;
// native crashes leave local minidumps in RetroShelf-data/crashes.
log.transports.file.resolvePathFn = () => path.join(DATA_DIR, 'logs', 'main.log');
log.initialize({ spyRendererConsole: true });
log.errorHandler.startCatching();
Object.assign(console, log.functions);
crashReporter.start({ uploadToServer: false });

// The Windows installer (Squirrel) starts the app during install and uninstall; quit then.
if (require('electron-squirrel-startup')) app.quit();

const { pathToFileURL } = require('url');
const { Store } = require('./store');
const { scanLibrary } = require('./scanner');
const { KNOWN_GAMES } = require('./knownGames');
const { resolveProfile, ERA_PROFILES } = require('./dosboxConfig');
const { lookupGame, refreshBoxart, boxartCandidates, META_VERSION } = require('./metadata');
const { searchUrl } = require('./abandonware');
const launchbox = require('./launchbox');
const KNOWN_ABANDONWARE_URLS = require('./abandonwareUrls');
const { RateLimitError, haltedHosts } = require('./http');
const { resolveTools, previewConfig, launchGame, effectiveDosLaunch } = require('./launcher');
const { saveUserImage, listUserShots, removeUserImage, userImagePath } = require('./userMedia');

let win = null;
let store = null;
let paths = null;
const running = new Map(); // id -> { child, startedAt }
const metaQueue = [];
const metaInFlight = new Set();
// Several games at once; politeFetch still allows only one request at a time per host.
const META_CONCURRENCY = 3;
const artQueue = []; // { id, reloadIndex }
let artBusy = null; // id of the game whose box art is downloading

const knownByKey = new Map(KNOWN_GAMES.map((k) => [k.key, k]));

// Release years must fall in the DOS era.
const MIN_YEAR = 1980;
const MAX_YEAR = 2005;

function fileUrl(p) {
  return p && fs.existsSync(p) ? pathToFileURL(p).href : null;
}

/**
 * A downloaded image's file in this game's media folder. Saved paths are reduced to their
 * file name, so the data folder still works after it has been moved.
 */
function mediaFile(id, saved) {
  return saved ? path.join(paths.media, id, path.basename(saved)) : null;
}

/** Cover URL with a version so a re-downloaded cover isn't served from the image cache. */
function coverUrl(id, meta) {
  const url = fileUrl(mediaFile(id, meta.cover));
  return url ? `${url}?v=${encodeURIComponent(meta.artAt || meta.fetchedAt || '')}` : null;
}

/**
 * A game's release year and where it came from: the user's entry, then fetched metadata,
 * then the curated entry. Every game needs one; `null` means the user must set it.
 */
function releaseYear(g) {
  const known = g.knownKey ? knownByKey.get(g.knownKey) : null;
  if (g.userYear) return { year: g.userYear, source: 'user' };
  if (g.meta && g.meta.year) return { year: g.meta.year, source: 'metadata' };
  if (known && known.year) return { year: known.year, source: 'curated' };
  return { year: null, source: null };
}

function validYear(y) {
  return Number.isInteger(y) && y >= MIN_YEAR && y <= MAX_YEAR;
}

function listImages(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|gif|bmp|webp)$/i.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/** The user's uploaded box art, if any. The file name changes with every upload, so it busts the image cache. */
function userCoverUrl(g) {
  return fileUrl(userImagePath(paths.userMedia, g.id, g.userCover));
}

function withKnown(g) {
  return { ...g, known: g.knownKey ? knownByKey.get(g.knownKey) : null, releaseYear: releaseYear(g).year };
}

function toView(g) {
  const meta = g.meta || {};
  const known = g.knownKey ? knownByKey.get(g.knownKey) : null;
  const shots = [
    ...listUserShots(paths.userMedia, g.id).map((p) => ({ url: fileUrl(p), caption: '', kind: 'upload', file: path.basename(p) })),
    ...(meta.screenshots || []).map((s) => ({ url: fileUrl(mediaFile(g.id, s.path)), caption: s.caption || '', kind: 'web' })),
    ...(g.localScreenshots || []).map((p) => ({ url: fileUrl(p), caption: '', kind: 'local' })),
    ...listImages(path.join(paths.captures, g.id)).map((p) => ({ url: fileUrl(p), caption: 'Your capture', kind: 'capture' })),
  ].filter((s) => s.url);
  const profile = g.engine === 'dosbox' ? resolveProfile(withKnown(g), store.settings) : null;
  const title = g.userTitle || g.title;
  const ry = releaseYear(g);
  return {
    id: g.id,
    title,
    folder: g.folder,
    folderName: g.folderName,
    engine: g.engine,
    source: g.source || null,
    missing: Boolean(g.missing),
    favorite: Boolean(g.favorite),
    playtimeSec: g.playtimeSec || 0,
    playCount: g.playCount || 0,
    lastPlayed: g.lastPlayed || null,
    addedAt: g.addedAt || null,
    running: running.has(g.id),
    year: ry.year,
    yearSource: ry.source,
    yearRange: [MIN_YEAR, MAX_YEAR],
    genre: g.userGenre || meta.genre || '',
    userGenre: g.userGenre || '',
    fetchedGenre: meta.genre || '',
    theme: meta.theme || '',
    perspective: meta.perspective || '',
    developer: meta.developer || '',
    publisher: meta.publisher || '',
    designer: meta.designer || '',
    series: meta.series || '',
    modes: meta.modes || '',
    released: meta.released || '',
    rating: meta.rating || '',
    dosboxSupport: meta.dosboxSupport || '',
    shortDescription: meta.shortDescription || '',
    description: g.userDescription || meta.description || '',
    userDescription: g.userDescription || '',
    descriptionSource: g.userDescription ? null : meta.descriptionSource || null,
    descriptionUrl: g.userDescription ? null : meta.descriptionUrl || null,
    wikiUrl: meta.wikiUrl || null,
    mobyUrl: meta.mobyUrl || null,
    hints: meta.hints || [],
    abandonwareUrl: meta.abandonwareUrl || g.userAbandonwareUrl || null,
    abandonwareSearchUrl: searchUrl(title),
    cover: userCoverUrl(g) || coverUrl(g.id, meta) || (shots[0] && shots[0].url) || null,
    hasRealCover: Boolean(userCoverUrl(g) || coverUrl(g.id, meta)),
    hasUserCover: Boolean(userCoverUrl(g)),
    artStatus: artBusy === g.id || artQueue.some((a) => a.id === g.id) ? 'loading' : 'idle',
    screenshots: shots,
    reqs: (known && known.reqs) || null,
    profile,
    eras: Object.fromEntries(Object.entries(ERA_PROFILES).map(([k, v]) => [k, v.label])),
    executables: g.executables || [],
    exe: g.exeOverride || g.exe || null,
    commands: g.engine === 'dosbox' ? effectiveDosLaunch(g, g.libraryRoot).commands : [],
    commandsOverridden: Array.isArray(g.commandsOverride) && g.commandsOverride.length > 0,
    overrides: g.overrides || {},
    boxartName: meta.boxartName || null,
    userBoxartName: g.userBoxartName || '',
    userAbandonwareUrl: g.userAbandonwareUrl || '',
    scummvm: g.engine === 'scummvm' ? g.launch.scummvm : null,
    metaStatus: metaInFlight.has(g.id) || metaQueue.includes(g.id) ? 'loading' : g.meta ? 'ok' : g.metaError ? 'error' : 'none',
    metaError: g.metaError || null,
    lookupWarnings: meta.lookupWarnings || [],
  };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function emitGame(id) {
  const g = store.game(id);
  if (g && !g.hidden) send('game:changed', toView(g));
}

// Hosts the user has already been told about.
const reportedHalts = new Set();

/** Tell the UI about hosts newly halted by a 429; lookups carry on with the other sources. */
function reportHalts() {
  const fresh = haltedHosts().filter((h) => !reportedHalts.has(h));
  if (!fresh.length) return;
  for (const h of fresh) reportedHalts.add(h);
  send('meta:halted', {
    hosts: [...reportedHalts],
    message: `${fresh.join(', ')} rate-limited RetroShelf (HTTP 429). It's skipped until restart; other sources keep going.`,
  });
}

function allViews() {
  return store.games().filter((g) => !g.hidden).map(toView);
}

function toolsView() {
  return { ...resolveTools(store.settings), platform: process.platform };
}

// --- Metadata queue ---------------------------------------------------------------

function enqueueMeta(ids) {
  for (const id of ids) {
    const g = store.game(id);
    if (!g || g.hidden) continue;
    if (!metaQueue.includes(id) && !metaInFlight.has(id)) metaQueue.push(id);
    emitGame(id);
  }
  pumpMeta();
}

function pumpMeta() {
  while (metaInFlight.size < META_CONCURRENCY && metaQueue.length) {
    const id = metaQueue.shift();
    metaInFlight.add(id);
    fetchMeta(id).finally(() => {
      metaInFlight.delete(id);
      emitGame(id);
      send('meta:progress', { pending: metaQueue.length + metaInFlight.size });
      pumpMeta();
    });
  }
  send('meta:progress', { pending: metaQueue.length + metaInFlight.size });
}

/** True when a game's last lookup ran before the LaunchBox database was ready. */
function missedLaunchBox(g) {
  return Boolean(g && g.meta && (g.meta.lookupWarnings || []).some((w) => w.endsWith(launchbox.STILL_DOWNLOADING)));
}

async function fetchMeta(id) {
  const g = store.game(id);
  if (!g) return;
  try {
    const meta = await lookupGame({
      title: g.userTitle || g.title,
      year: releaseYear(g).year,
      folder: g.missing ? null : g.folder,
      abandonwareUrl: g.userAbandonwareUrl || (g.knownKey && KNOWN_ABANDONWARE_URLS[g.knownKey]) || null,
      boxartName: g.userBoxartName || null,
      mobyApiKey: store.settings.mobyApiKey || null,
      cacheDir: path.join(paths.media, id),
      indexFile: paths.libretroIndex,
      uhsIndexFile: paths.uhsIndex,
    });
    // The era of uncurated games is derived from the release year whenever the profile is resolved.
    store.updateGame(id, { meta, metaError: null, metaErrorVersion: null });
    // LaunchBox finished while this lookup ran: the startup recheck already passed this game.
    if (missedLaunchBox(store.game(id)) && launchbox.isReady() && !metaQueue.includes(id)) metaQueue.push(id);
  } catch (err) {
    log.warn(`Metadata lookup failed for ${g.folderName}:`, err);
    store.updateGame(id, { metaError: err.message, metaErrorVersion: META_VERSION });
  }
  reportHalts();
}

// --- Box art refresh ----------------------------------------------------------------
// Re-matches and re-downloads only the cover, one game at a time. Games without metadata
// get a full metadata fetch instead, since that includes box art.

function enqueueArt(ids, reloadIndex) {
  let queued = 0;
  // Only the first box art job in a batch reloads the index; the rest reuse it.
  let reload = reloadIndex;
  for (const id of ids) {
    const g = store.game(id);
    if (!g || g.hidden || g.missing) continue;
    if (!g.meta) {
      enqueueMeta([id]);
    } else if (artBusy !== id && !artQueue.some((a) => a.id === id)) {
      artQueue.push({ id, reloadIndex: reload });
      reload = false;
      emitGame(id);
    }
    queued++;
  }
  pumpArt();
  return queued;
}

async function pumpArt() {
  if (artBusy) return;
  while (artQueue.length) {
    const { id, reloadIndex } = artQueue.shift();
    artBusy = id;
    send('art:progress', { pending: artQueue.length + 1 });
    const g = store.game(id);
    try {
      if (g) {
        const art = await refreshBoxart({
          title: g.userTitle || g.title,
          year: releaseYear(g).year,
          boxartName: g.userBoxartName || null,
          cacheDir: path.join(paths.media, id),
          indexFile: paths.libretroIndex,
          reloadIndex,
        });
        const warnings = ((g.meta && g.meta.lookupWarnings) || []).filter((w) => !/^(No box art match|Box art:)/.test(w));
        store.updateGame(id, { meta: { ...g.meta, ...art, lookupWarnings: warnings } });
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        // Box art has a single source, so a 429 from it ends the whole batch.
        const dropped = artQueue.splice(0);
        artBusy = null;
        for (const a of dropped) emitGame(a.id);
        emitGame(id);
        reportHalts();
        send('art:progress', { pending: 0 });
        return;
      }
      if (g) store.updateGame(id, { meta: { ...g.meta, lookupWarnings: [`Box art: ${err.message}`] } });
    }
    artBusy = null;
    emitGame(id);
  }
  send('art:progress', { pending: 0 });
}

// --- Library ----------------------------------------------------------------------

function readable(dir) {
  try {
    fs.readdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

function scanAll() {
  // A folder macOS hasn't granted access to yet can't be read; leave its games as they are
  // instead of marking them all missing.
  const present = store.settings.libraryFolders.filter((r) => fs.existsSync(r));
  const roots = present.filter(readable);
  const blocked = present.filter((r) => !roots.includes(r));
  if (blocked.length) {
    send('library:blocked', {
      message: `Can't read ${blocked.join(', ')}. Allow RetroShelf in System Settings › Privacy & Security › Files and Folders, then Rescan.`,
    });
  }
  // RetroShelf-data can sit inside a library folder; it isn't a game.
  const scanned = roots.flatMap((r) => scanLibrary(r, { skip: [DATA_DIR] }));
  const added = store.mergeScan(scanned, roots);
  if (store.settings.autoFetchMetadata) {
    // Games the current sources found nothing for are left alone until the sources change.
    const noMatch = (g) => g.metaError && g.metaErrorVersion === META_VERSION;
    // Metadata from older sources is fetched again.
    const stale = (g) => !g.meta || g.meta.sourcesVersion !== META_VERSION;
    enqueueMeta(store.games().filter((g) => stale(g) && !g.missing && !g.hidden && !noMatch(g)).map((g) => g.id));
  }
  return { added: added.length, total: scanned.length };
}

// Only these fields can be changed from the UI.
const EDITABLE = new Set(['favorite', 'userTitle', 'userYear', 'userBoxartName', 'userAbandonwareUrl', 'exeOverride', 'commandsOverride', 'overrides', 'userDescription', 'userGenre']);

function hiddenList() {
  return store.games()
    .filter((g) => g.hidden && !g.missing)
    .map((g) => ({ id: g.id, title: g.userTitle || g.title, folder: g.folder }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({ settings: store.settings, tools: toolsView(), games: allViews(), paths }));

  ipcMain.handle('settings:update', (_e, patch) => {
    const settings = store.updateSettings(patch);
    send('library:changed', allViews());
    return { settings, tools: toolsView() };
  });

  ipcMain.handle('library:addFolder', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Choose a folder of DOS games', properties: ['openDirectory'] });
    if (res.canceled || !res.filePaths[0]) return null;
    const folder = path.resolve(res.filePaths[0]);
    store.updateSettings({ libraryFolders: Array.from(new Set([...store.settings.libraryFolders, folder])) });
    const summary = scanAll();
    return { settings: store.settings, games: allViews(), summary };
  });

  ipcMain.handle('library:removeFolder', (_e, folder) => {
    store.updateSettings({ libraryFolders: store.settings.libraryFolders.filter((f) => f !== folder) });
    store.removeRoot(folder);
    return { settings: store.settings, games: allViews() };
  });

  ipcMain.handle('library:scan', () => {
    const summary = scanAll();
    return { games: allViews(), summary };
  });

  ipcMain.handle('meta:fetch', (_e, id) => enqueueMeta([id]));

  ipcMain.handle('meta:boxartCandidates', (_e, id, query) => {
    const g = store.game(id);
    if (!g) return [];
    return boxartCandidates({ title: query || g.userTitle || g.title, year: releaseYear(g).year, indexFile: paths.libretroIndex });
  });

  ipcMain.handle('art:refresh', (_e, id) => enqueueArt([id], false));

  ipcMain.handle('art:refreshAll', (_e, { reloadIndex }) => enqueueArt(store.games().map((g) => g.id), Boolean(reloadIndex)));

  // Removing hides a game from the library; its files on disk are never touched.
  ipcMain.handle('game:remove', (_e, id) => {
    const g = store.game(id);
    if (!g) throw new Error('Unknown game');
    const qi = metaQueue.indexOf(id);
    if (qi >= 0) metaQueue.splice(qi, 1);
    const ai = artQueue.findIndex((a) => a.id === id);
    if (ai >= 0) artQueue.splice(ai, 1);
    store.updateGame(id, { hidden: true });
    return hiddenList();
  });

  ipcMain.handle('game:restore', (_e, id) => {
    const g = store.game(id);
    if (!g) throw new Error('Unknown game');
    store.updateGame(id, { hidden: false });
    return { game: toView(store.game(id)), hidden: hiddenList() };
  });

  ipcMain.handle('library:hidden', () => hiddenList());

  ipcMain.handle('meta:fetchAll', (_e, { onlyMissing }) => {
    const ids = store.games().filter((g) => !g.missing && (!onlyMissing || !g.meta)).map((g) => g.id);
    enqueueMeta(ids);
    return ids.length;
  });

  ipcMain.handle('game:update', (_e, id, patch) => {
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) if (EDITABLE.has(k)) clean[k] = v;
    if ('userYear' in clean && clean.userYear !== null && !validYear(clean.userYear)) {
      throw new Error(`Release year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
    }
    store.updateGame(id, clean);
    return toView(store.game(id));
  });

  // Uploaded images arrive as { name, data } with the file's bytes.
  ipcMain.handle('media:setCover', (_e, id, file) => {
    const g = store.game(id);
    if (!g) throw new Error('Unknown game');
    const saved = saveUserImage(paths.userMedia, id, file, 'cover');
    if (g.userCover) removeUserImage(paths.userMedia, id, g.userCover);
    store.updateGame(id, { userCover: saved });
    return toView(store.game(id));
  });

  ipcMain.handle('media:clearCover', (_e, id) => {
    const g = store.game(id);
    if (!g) throw new Error('Unknown game');
    if (g.userCover) removeUserImage(paths.userMedia, id, g.userCover);
    store.updateGame(id, { userCover: null });
    return toView(store.game(id));
  });

  ipcMain.handle('media:addShots', (_e, id, files) => {
    if (!store.game(id)) throw new Error('Unknown game');
    for (const f of files) saveUserImage(paths.userMedia, id, f, 'shot');
    return toView(store.game(id));
  });

  ipcMain.handle('media:removeShot', (_e, id, file) => {
    if (!store.game(id)) throw new Error('Unknown game');
    removeUserImage(paths.userMedia, id, file);
    return toView(store.game(id));
  });

  ipcMain.handle('game:preview', (_e, id) => {
    const g = store.game(id);
    return g ? previewConfig(withKnown({ ...g, title: g.userTitle || g.title }), store.settings, paths) : '';
  });

  ipcMain.handle('game:launch', async (_e, id) => {
    const g = store.game(id);
    if (!g) throw new Error('Unknown game');
    if (running.has(id)) throw new Error(`${g.userTitle || g.title} is already running.`);
    if (!releaseYear(g).year) throw new Error(`${g.userTitle || g.title}: release year required. Set it in Edit info.`);
    const { child, configPath } = await launchGame(withKnown({ ...g, title: g.userTitle || g.title }), store.settings, paths);
    const startedAt = Date.now();
    running.set(id, { child, startedAt });
    store.updateGame(id, { lastPlayed: new Date().toISOString(), playCount: (g.playCount || 0) + 1 });
    emitGame(id);
    child.once('exit', (code) => {
      running.delete(id);
      const cur = store.game(id);
      const secs = Math.round((Date.now() - startedAt) / 1000);
      store.updateGame(id, { playtimeSec: ((cur && cur.playtimeSec) || 0) + secs });
      emitGame(id);
      send('game:exited', { id, code, secs });
    });
    return { configPath };
  });

  ipcMain.handle('game:openFolder', (_e, id) => {
    const g = store.game(id);
    if (g) shell.openPath(g.folder);
  });

  // Opens a hint file found in the game's own folder; any other path is refused.
  ipcMain.handle('game:openHint', (_e, id, file) => {
    const g = store.game(id);
    const hint = g && g.meta && (g.meta.hints || []).find((h) => h.kind === 'file' && h.path === file);
    if (!hint || !path.resolve(file).startsWith(path.resolve(g.folder) + path.sep)) throw new Error('Unknown hint file');
    return shell.openPath(file);
  });

  ipcMain.handle('game:openConfigFolder', () => shell.openPath(paths.configs));

  ipcMain.handle('shell:open', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('dialog:pickFile', async (_e, opts = {}) => {
    const res = await dialog.showOpenDialog(win, {
      title: opts.title || 'Choose a file',
      properties: [opts.directory ? 'openDirectory' : 'openFile'],
      filters: opts.filters,
    });
    return res.canceled ? null : res.filePaths[0];
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    // Bootstrap's body background for the system theme. The window stays hidden until the
    // first paint, so a light/dark mode chosen in the app never flashes the other theme.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#212529' : '#ffffff',
    show: false,
    title: 'RetroShelf',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));
  // Links inside the renderer always open in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.on('render-process-gone', (_e, _wc, details) => log.error('Renderer process gone:', details));
app.on('child-process-gone', (_e, details) => log.error('Child process gone:', details));

app.whenReady().then(() => {
  log.info(`RetroShelf ${app.getVersion()} starting (Electron ${process.versions.electron}, Node ${process.versions.node})`);
  const base = app.getPath('userData');
  paths = {
    data: base,
    media: path.join(base, 'media'),
    userMedia: path.join(base, 'user-media'),
    configs: path.join(base, 'configs'),
    captures: path.join(base, 'captures'),
    saves: path.join(base, 'saves'),
    libretroIndex: path.join(base, 'libretro-dos-index.json'),
    launchboxIndex: path.join(base, 'launchbox-dos-index.json'),
    uhsIndex: path.join(base, 'uhs-index.json'),
  };
  store = new Store(base);
  // Library folders can be passed on the command line: `npm start -- ~/Documents/dosgames`.
  const argFolders = process.argv
    .slice(app.isPackaged ? 1 : 2)
    .filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isDirectory() && path.resolve(a) !== path.resolve(app.getAppPath()));
  if (argFolders.length) {
    store.updateSettings({ libraryFolders: Array.from(new Set([...store.settings.libraryFolders, ...argFolders.map((a) => path.resolve(a))])) });
  }
  registerIpc();
  createWindow();
  // LaunchBox's database builds in the background (the first time it downloads ~100 MB);
  // games looked up before it was ready are looked up again once it is.
  launchbox.loadIndex(paths.launchboxIndex).then(() => {
    enqueueMeta(store.games().filter((g) => missedLaunchBox(g) && !g.hidden && !g.missing).map((g) => g.id));
  }, () => {
    // fetchLaunchBox reports the failure in each game's lookup warnings.
  });
  if (store.settings.libraryFolders.length) scanAll();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
