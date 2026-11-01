'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_SETTINGS = {
  libraryFolders: [],
  dosboxPath: '',
  scummvmPath: '',
  soundfont: '',
  mt32RomDir: '',
  shader: 'crt-auto',
  fullscreen: true,
  integerScaling: 'auto',
  midiPreference: 'auto',
  reverb: 'small',
  chorus: 'light',
  crossfeed: 'off',
  ignorePrimaryConf: false,
  scummvmFiltering: false,
  mobyApiKey: '',
  autoFetchMetadata: true,
};

// Fields the user owns; a rescan must never overwrite them.
const USER_FIELDS = [
  'overrides', 'favorite', 'playtimeSec', 'playCount', 'lastPlayed', 'addedAt', 'meta', 'metaError',
  'userTitle', 'userYear', 'userBoxartName', 'userAbandonwareUrl', 'exeOverride', 'commandsOverride', 'hidden',
  'userDescription', 'userGenre', 'userCover',
];

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'library.json');
    this.data = { settings: { ...DEFAULT_SETTINGS }, games: {} };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
      this.data.games = raw.games || {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Keep a copy of an unreadable library instead of silently replacing it.
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      }
    }
  }

  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  games() {
    return Object.values(this.data.games);
  }

  game(id) {
    return this.data.games[id] || null;
  }

  /** Merge a fresh scan in, keeping user data. Returns ids of newly added games. */
  mergeScan(scanned, roots) {
    const added = [];
    const seen = new Set();
    for (const g of scanned) {
      seen.add(g.id);
      const prev = this.data.games[g.id];
      const keep = {};
      if (prev) {
        for (const k of USER_FIELDS) if (prev[k] !== undefined) keep[k] = prev[k];
      } else {
        added.push(g.id);
      }
      this.data.games[g.id] = { ...g, ...keep, missing: false, addedAt: keep.addedAt || new Date().toISOString() };
    }
    // Games under a scanned root that weren't found are marked missing rather than deleted,
    // so play time and tweaks survive an unplugged drive.
    const resolvedRoots = roots.map((r) => path.resolve(r));
    for (const g of this.games()) {
      if (!seen.has(g.id) && resolvedRoots.includes(g.libraryRoot)) g.missing = true;
    }
    this.save();
    return added;
  }

  updateGame(id, patch) {
    const g = this.data.games[id];
    if (!g) throw new Error(`Unknown game ${id}`);
    Object.assign(g, patch);
    this.save();
    return g;
  }

  removeRoot(root) {
    const r = path.resolve(root);
    for (const [id, g] of Object.entries(this.data.games)) if (g.libraryRoot === r) delete this.data.games[id];
    this.save();
  }
}

module.exports = { Store, DEFAULT_SETTINGS };
