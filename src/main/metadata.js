'use strict';

const fs = require('fs');
const path = require('path');
const { fetchMyAbandonware } = require('./abandonware');
const libretro = require('./libretro');
const { fetchWikipedia } = require('./wikipedia');
const { fetchLaunchBox } = require('./launchbox');
const { fetchArchiveGame } = require('./archive');
const { findHints } = require('./hints');
const { htmlToText } = require('./html');
const { RateLimitError, politeFetch } = require('./http');

/** Bumped when sources change, so saved metadata from older sources is fetched again. */
const META_VERSION = 2;

/** MyAbandonware's generated blurb ("…is available and ready to be played again!") isn't a description. */
function isFiller(text) {
  return /available and ready to be played again/i.test(text || '');
}

/** Optional: MobyGames API (needs a free key) adds a description, more screenshots and genres. */
async function fetchMobyGames(title, apiKey) {
  const DOS_PLATFORM = 2;
  const q = new URLSearchParams({ title, platform: String(DOS_PLATFORM), format: 'normal', api_key: apiKey });
  const res = await politeFetch(`https://api.mobygames.com/v1/games?${q}`);
  const data = await res.json();
  const game = data && data.games && data.games[0];
  if (!game) return null;
  const shotsRes = await politeFetch(`https://api.mobygames.com/v1/games/${game.game_id}/platforms/${DOS_PLATFORM}/screenshots?api_key=${encodeURIComponent(apiKey)}`);
  const shots = await shotsRes.json();
  return {
    url: game.moby_url,
    description: htmlToText(game.description),
    genre: (game.genres || []).map((g) => g.genre_name).join(', '),
    screenshotUrls: ((shots && shots.screenshots) || []).map((s) => ({ url: s.image, caption: s.caption || '' })),
  };
}

function extFromUrl(url) {
  const m = url.match(/\.(png|jpe?g|gif|webp|bmp)$/i);
  return m ? m[0].toLowerCase() : '.jpg';
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return dest;
  const res = await politeFetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

/** The title as libretro names it ("Ultimate DOOM, The (1995)" -> "The Ultimate DOOM"). */
function canonicalTitle(artName) {
  return artName.replace(/\s*\([^)]*\)/g, '').replace(/^(.*), (The|A|An)$/i, '$2 $1').replace(/_/g, ':');
}

/**
 * Look up a game from every source and cache its art. Each kind of data has its own chain
 * of sources. A source that fails or answers 429 (which halts that host for the session) is
 * skipped with a warning, and the next source in the chain is used.
 *  - Description: Wikipedia, LaunchBox, MobyGames (with a key), Internet Archive, then the
 *    MyAbandonware page when its URL is known.
 *  - Year and credits: MyAbandonware page, LaunchBox, Wikipedia, Internet Archive.
 *  - Box art, title screen and a gameplay snap: libretro-thumbnails (matched offline).
 *  - Hint guides: every source in hints.js.
 * @returns metadata object with local `cover` and `screenshots` file paths
 */
async function lookupGame({ title, year, folder, abandonwareUrl, boxartName, mobyApiKey, cacheDir, indexFile, uhsIndexFile, maxScreenshots = 4 }) {
  const warnings = [];
  const attempt = async (source, run) => {
    try {
      return await run();
    } catch (err) {
      warnings.push(err instanceof RateLimitError ? `${source}: rate-limited (HTTP 429), skipped this session.` : `${source}: ${err.message}`);
      return null;
    }
  };

  const index = await attempt('Box art', () => libretro.loadIndex(indexFile));
  const artName = index ? boxartName || libretro.bestMatch(index, title, year) : null;
  const art = artName ? libretro.imagesFor(index, artName) : {};
  if (index && !artName) warnings.push('No box art match. Pick one in Edit info.');
  // The libretro name is the canonical title, which matches the text sources better than a folder name.
  const name = artName ? canonicalTitle(artName) : title;

  // Each source is a different host, so they're queried together; politeFetch still spaces
  // out requests to any one host.
  const [mab, wiki, lb, moby, found] = await Promise.all([
    abandonwareUrl ? attempt('MyAbandonware', () => fetchMyAbandonware({ url: abandonwareUrl })) : null,
    attempt('Wikipedia', () => fetchWikipedia({ title: name, year })),
    attempt('LaunchBox', () => fetchLaunchBox({ title: name, year })),
    mobyApiKey ? attempt('MobyGames', () => fetchMobyGames(name, mobyApiKey)) : null,
    findHints({ title: name, folder, uhsIndexFile }),
  ]);
  warnings.push(...found.warnings);
  if (mab && isFiller(mab.description)) mab.description = '';
  const has = (r) => Boolean(r && r.description);
  const ia = has(wiki) || has(lb) || has(moby) ? null : await attempt('Internet Archive', () => fetchArchiveGame({ title: name, year }));

  const described = [['Wikipedia', wiki], ['LaunchBox', lb], ['MobyGames', moby], ['Internet Archive', ia], ['MyAbandonware', mab]].find(([, r]) => has(r));
  if (!described) warnings.push('No description found on Wikipedia, LaunchBox, Internet Archive or MyAbandonware.');
  const first = (key, ...rs) => rs.map((r) => r && r[key]).find(Boolean) || null;

  if (!artName && !described && !mab && !lb && !found.hints.length) throw new Error(`Nothing found for "${title}". ${warnings.join(' ')}`);

  const meta = {
    ...(mab || {}),
    year: first('year', mab, lb, wiki, ia),
    genre: first('genre', mab, lb, moby) || '',
    developer: first('developer', mab, lb) || '',
    publisher: first('publisher', mab, lb) || '',
    description: described ? described[1].description : '',
    descriptionSource: described ? described[0] : null,
    descriptionUrl: described ? described[1].url || described[1].abandonwareUrl || null : null,
    wikiUrl: wiki ? wiki.url : null,
    mobyUrl: moby ? moby.url : null,
    hints: found.hints,
    boxartName: artName,
    coverUrl: art.boxart || (mab && mab.coverUrl) || null,
    screenshotUrls: [],
    lookupWarnings: warnings,
    sourcesVersion: META_VERSION,
  };
  // Gameplay first, title screen last: MyAbandonware shots, the libretro snap, MobyGames, then the title.
  const shots = [...((mab && mab.screenshotUrls) || [])];
  if (art.snap) shots.push({ url: art.snap, caption: 'Gameplay' });
  if (moby) shots.push(...moby.screenshotUrls);
  if (art.title) shots.push({ url: art.title, caption: 'Title screen' });
  meta.screenshotUrls = shots.slice(0, maxScreenshots);
  if (!art.title && !art.snap && meta.screenshotUrls.length === 0) warnings.push('No screenshots found.');

  // Download into a fresh folder and swap it in, so a failed re-lookup never loses the old art
  // and a re-lookup that matched a different game doesn't keep stale images.
  const fresh = `${cacheDir}.new`;
  fs.rmSync(fresh, { recursive: true, force: true });
  fs.mkdirSync(fresh, { recursive: true });
  let coverFile = null;
  if (meta.coverUrl) {
    const f = await attempt('Box art', () => download(meta.coverUrl, path.join(fresh, `cover${extFromUrl(meta.coverUrl)}`)));
    if (f) coverFile = path.basename(f);
  }
  const shotFiles = [];
  for (const [i, s] of meta.screenshotUrls.entries()) {
    try {
      const f = await download(s.url, path.join(fresh, `shot-${i}${extFromUrl(s.url)}`));
      shotFiles.push({ file: path.basename(f), caption: s.caption });
    } catch {
      // A single missing image shouldn't fail the whole lookup.
    }
  }
  fs.rmSync(cacheDir, { recursive: true, force: true });
  fs.renameSync(fresh, cacheDir);
  meta.cover = coverFile ? path.join(cacheDir, coverFile) : null;
  meta.screenshots = shotFiles.map((s) => ({ path: path.join(cacheDir, s.file), caption: s.caption }));
  meta.fetchedAt = new Date().toISOString();
  return meta;
}

/**
 * Re-match and re-download only the box art; description and screenshots are untouched.
 * `reloadIndex` downloads the libretro index again first, to pick up newly added box art.
 * @returns {{ boxartName, coverUrl, cover, artAt }}
 */
async function refreshBoxart({ title, year, boxartName, cacheDir, indexFile, reloadIndex = false }) {
  const index = await libretro.loadIndex(indexFile, { force: reloadIndex });
  const artName = boxartName || libretro.bestMatch(index, title, year);
  if (!artName) throw new Error('No box art match. Pick one in Edit info.');
  const coverUrl = libretro.imagesFor(index, artName).boxart;
  if (!coverUrl) throw new Error(`"${artName}" is no longer in the box art set. Pick another in Edit info.`);
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const f of fs.readdirSync(cacheDir)) if (/^cover\./.test(f)) fs.rmSync(path.join(cacheDir, f), { force: true });
  const cover = await download(coverUrl, path.join(cacheDir, `cover${extFromUrl(coverUrl)}`));
  return { boxartName: artName, coverUrl, cover, artAt: new Date().toISOString() };
}

/** Box art candidates for the Edit dialog (offline, from the cached index). */
async function boxartCandidates({ title, year, indexFile }) {
  const index = await libretro.loadIndex(indexFile);
  return libretro.candidates(index, title, year, 15);
}

module.exports = { lookupGame, refreshBoxart, boxartCandidates, META_VERSION, isFiller };
