'use strict';

// LaunchBox Games Database: the public Metadata.zip dump holds an overview, year, developer,
// publisher and genres for nearly every MS-DOS release. It is downloaded once, reduced to the
// MS-DOS games and cached as JSON, so matching costs no network traffic afterwards.
// The zip is read with yauzl and Metadata.xml is parsed as a stream with htmlparser2.

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');
const { Parser } = require('htmlparser2');
const { politeFetch } = require('./http');
const { clean, sameGame, yearClash } = require('./match');

const ZIP_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const ENTRY = 'Metadata.xml';
const PLATFORM = 'MS-DOS';
const INDEX_MAX_AGE_MS = 30 * 24 * 3600 * 1000;

let memo = null;
let ready = null; // the built index, once loadIndex has finished
let failure = null; // why the build failed, if it did
const STILL_DOWNLOADING = 'database still downloading; games without a description are rechecked when it finishes.';

/** Reduce one <Game> element's fields to what RetroShelf uses, or null for other platforms. */
function toGame(f) {
  const text = (k) => (f[k] || '').trim();
  if (text('Platform') !== PLATFORM || !text('Name')) return null;
  return {
    name: text('Name'),
    year: Number(text('ReleaseYear')) || Number(text('ReleaseDate').slice(0, 4)) || null,
    overview: text('Overview'),
    developer: text('Developer'),
    publisher: text('Publisher'),
    genre: text('Genres').split(';').map((g) => g.trim()).filter(Boolean).join(', '),
    id: text('DatabaseID'),
  };
}

/** Collect the MS-DOS <Game> records from a Metadata.xml stream. */
async function parseGames(xmlStream) {
  const games = [];
  let game = null; // fields of the <Game> being read
  let field = null; // the child element being read
  const parser = new Parser({
    onopentag(name) {
      if (name === 'Game' && !game) game = {};
      else if (game) field = name;
    },
    ontext(text) {
      if (game && field) game[field] = (game[field] || '') + text;
    },
    onclosetag(name) {
      if (name === 'Game' && game) {
        const g = toGame(game);
        if (g) games.push(g);
        game = null;
      }
      field = null;
    },
  }, { xmlMode: true, decodeEntities: true });
  xmlStream.setEncoding('utf8');
  for await (const chunk of xmlStream) parser.write(chunk);
  parser.end();
  return games;
}

/** Open Metadata.xml inside the zip as a stream. */
function openEntry(zipFile) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipFile, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = false;
      zip.on('error', reject);
      zip.on('end', () => {
        if (!found) reject(new Error(`${ENTRY} missing from the archive`));
      });
      zip.on('entry', (entry) => {
        if (entry.fileName !== ENTRY) return zip.readEntry();
        found = true;
        zip.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          stream.on('end', () => zip.close());
          resolve(stream);
        });
      });
      zip.readEntry();
    });
  });
}

/** Read the MS-DOS games out of a LaunchBox Metadata.zip. */
async function extractGames(zipFile) {
  return parseGames(await openEntry(zipFile));
}

/** Normalized titles are computed once per session, not on every lookup. */
function withNorms(games) {
  for (const g of games) g.norm = clean(g.name);
  return games;
}

/**
 * Load the MS-DOS index from cache, or download and build it once when the cache is
 * missing or stale. The downloaded zip is deleted after the index is built. Concurrent
 * callers share one build.
 */
async function loadIndex(cacheFile) {
  if (memo) return memo;
  memo = (async () => {
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < INDEX_MAX_AGE_MS) return withNorms(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    } catch {
      // No usable cache; build it below.
    }
    const zipFile = path.join(path.dirname(cacheFile), 'launchbox-metadata.zip.part');
    try {
      // ~100 MB: no overall timeout; this runs in the background and blocks nothing.
      const res = await politeFetch(ZIP_URL, { accept: 'application/zip', timeoutMs: 0 });
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(zipFile));
      const games = await extractGames(zipFile);
      fs.writeFileSync(cacheFile, JSON.stringify(games));
      return withNorms(games);
    } finally {
      fs.rmSync(zipFile, { force: true });
    }
  })();
  memo.then((games) => { ready = games; }, (err) => { failure = err; });
  // A failed download is remembered for the session, so it isn't repeated for every game.
  return memo;
}

/** Pick the game for a title and year: exact title first, then a title with a subtitle. */
function pickGame(games, title, year) {
  const want = clean(title);
  const fits = (g) => !yearClash(g.year, year);
  const exact = games.filter((g) => (g.norm || clean(g.name)) === want && fits(g));
  const pool = exact.length ? exact : games.filter((g) => sameGame(g.name, title) && fits(g));
  pool.sort((a, b) => Number(b.year === year) - Number(a.year === year) || Number(Boolean(b.overview)) - Number(Boolean(a.overview)));
  const g = pool[0];
  if (!g) return null;
  return {
    description: g.overview,
    year: g.year,
    developer: g.developer,
    publisher: g.publisher,
    genre: g.genre,
    url: g.id ? `https://gamesdb.launchbox-app.com/games/details/${g.id}` : null,
  };
}

/**
 * Match against the index without waiting for it: the first build downloads ~100 MB, and
 * lookups must not stall behind it. Start loadIndex at startup and recheck games when it ends.
 */
function fetchLaunchBox({ title, year }) {
  if (failure) throw new Error(`database download failed: ${failure.message}`);
  if (!ready) throw new Error(STILL_DOWNLOADING);
  return pickGame(ready, title, year);
}

function isReady() {
  return Boolean(ready);
}

module.exports = { fetchLaunchBox, loadIndex, isReady, extractGames, parseGames, pickGame, STILL_DOWNLOADING };
