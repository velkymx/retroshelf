'use strict';

// Box art, title screens and gameplay snaps from the libretro-thumbnails DOS set
// (github.com/libretro-thumbnails/DOS). The whole file index is one request and is cached,
// so matching a game costs no network traffic at all; only the chosen images are downloaded.

const fs = require('fs');
const { politeFetch } = require('./http');

const INDEX_URL = 'https://api.github.com/repos/libretro-thumbnails/DOS/git/trees/master?recursive=1';
const RAW_BASE = 'https://raw.githubusercontent.com/libretro-thumbnails/DOS/master';
const INDEX_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const FOLDERS = { boxart: 'Named_Boxarts', title: 'Named_Titles', snap: 'Named_Snaps' };

const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
const STOP_WORDS = new Set(['the', 'a', 'an', 'sid', 'meiers']);

let memo = null;

/**
 * Load the index from cache, or download it once when the cache is missing or stale.
 * `force` downloads it again regardless, to pick up box art added upstream.
 */
async function loadIndex(cacheFile, { force = false } = {}) {
  if (memo && !force) return memo;
  let tree = null;
  if (!force) {
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < INDEX_MAX_AGE_MS) tree = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      // No usable cache; fetch below.
    }
  }
  if (!tree) {
    const res = await politeFetch(INDEX_URL, { accept: 'application/vnd.github+json' });
    tree = await res.json();
    fs.writeFileSync(cacheFile, JSON.stringify(tree));
  }
  memo = buildIndex(tree);
  return memo;
}

function buildIndex(tree) {
  const index = { boxart: new Set(), title: new Set(), snap: new Set(), entries: [], titleByNorm: new Map(), snapByNorm: new Map() };
  for (const item of tree.tree || []) {
    const m = item.path.match(/^(Named_Boxarts|Named_Titles|Named_Snaps)\/(.+)\.png$/);
    if (!m) continue;
    const kind = Object.keys(FOLDERS).find((k) => FOLDERS[k] === m[1]);
    index[kind].add(m[2]);
  }
  // Box art drives matching; title/snap images are found by exact name, else by a variant
  // with the same normalized title (e.g. "DOOM (1993)" borrows "Doom"'s snap).
  for (const name of index.boxart) index.entries.push({ name, ...parseName(name) });
  for (const [kind, map] of [['title', index.titleByNorm], ['snap', index.snapByNorm]]) {
    for (const name of index[kind]) {
      const p = parseName(name);
      if (p.tags.some(isBadTag)) continue;
      if (!map.has(p.norm)) map.set(p.norm, name);
    }
  }
  return index;
}

function isBadTag(t) {
  return /demo|shareware|beta|prototype/.test(t);
}

/** Split "Ultimate DOOM, The (1995)" into comparable parts. */
function parseName(name) {
  const years = [...name.matchAll(/\((\d{4})\)/g)].map((m) => Number(m[1]));
  const tags = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].toLowerCase()).filter((t) => !/^\d{4}$/.test(t));
  const base = name.replace(/\s*\([^)]*\)/g, '').replace(/^(.*), (The|A|An)$/i, '$2 $1');
  return { year: years[0] || null, tags, norm: normalize(base) };
}

function normalize(s) {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[_:\-–—.,!?/]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => ROMAN[w] || w)
    .join(' ');
}

function numbers(s) {
  return s.split(' ').filter((w) => /^\d{1,2}$/.test(w)).join(',');
}

function scoreEntry(entry, want, wantWords, year) {
  let en = entry.norm;
  const wantNums = numbers(want);
  // "Quest for Glory I" is just "Quest for Glory" when the wanted title has no number.
  if (!wantNums) en = en.split(' ').filter((w) => w !== '1').join(' ');
  const enNums = numbers(en);
  let score = 0;
  if (en === want) score += 100;
  else if (en.includes(' ') && want.includes(' ')) {
    // Prefix/suffix containment, e.g. "Laura Bow 1: The Colonel's Bequest".
    if (en.startsWith(`${want} `) || en.endsWith(` ${want}`) || want.startsWith(`${en} `) || want.endsWith(` ${en}`)) score += 55;
  }
  const words = en.split(' ');
  const overlap = words.filter((w) => wantWords.has(w)).length;
  score += (overlap / Math.max(wantWords.size, words.length)) * 60;
  // A different number in the title (sequel) is a hard mismatch.
  if (wantNums !== enNums && (wantNums || !en.endsWith(` ${want}`))) score -= 40;
  if (entry.tags.some(isBadTag)) score -= 50;
  if (year && entry.year) score += entry.year === year ? 10 : -Math.min(Math.abs(entry.year - year), 4) * 3;
  return score;
}

/** Best candidates for a title, highest score first. */
function candidates(index, title, year, limit = 12) {
  const want = normalize(title);
  const wantWords = new Set(want.split(' '));
  return index.entries
    .map((e) => ({ name: e.name, score: Math.round(scoreEntry(e, want, wantWords, year)) }))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit);
}

function bestMatch(index, title, year) {
  const [top] = candidates(index, title, year, 1);
  return top && top.score >= 70 ? top.name : null;
}

function imageUrl(kind, name) {
  return `${RAW_BASE}/${FOLDERS[kind]}/${encodeURIComponent(name)}.png`;
}

/** Image URLs for a matched name: box art plus whatever title/snap images exist. */
function imagesFor(index, name) {
  const norm = parseName(name).norm;
  const titleName = index.title.has(name) ? name : index.titleByNorm.get(norm);
  const snapName = index.snap.has(name) ? name : index.snapByNorm.get(norm);
  return {
    boxart: index.boxart.has(name) ? imageUrl('boxart', name) : null,
    title: titleName ? imageUrl('title', titleName) : null,
    snap: snapName ? imageUrl('snap', snapName) : null,
  };
}

module.exports = { loadIndex, buildIndex, candidates, bestMatch, imagesFor, normalize, parseName };
