'use strict';

// Hint guides from every source that has them, all collected (not first hit wins):
//  - files already in the game folder (hint books, walkthroughs, solutions)
//  - Universal Hint System (uhs-hints.com), matched offline against its cached game list
//  - StrategyWiki walkthroughs
//  - Internet Archive scanned hint books and strategy guides (direct PDF links)
// A source that fails or is rate-limited is skipped with a warning; the others still run.

const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const { politeFetch } = require('./http');
const { sameGame, clean } = require('./match');
const { fetchArchiveGuides } = require('./archive');

const UHS_INDEX_URL = 'https://www.uhs-hints.com/hints/allhints.php';
const UHS_BASE = 'https://www.uhs-hints.com';
const UHS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const STRATEGYWIKI_API = 'https://strategywiki.org/w/api.php';
const LOCAL_NAME = /hint|walk ?thr|solution|solve|guide|cheat|clue|spoil|faq/i;
const LOCAL_EXT = /\.(pdf|txt|doc|docx|htm|html|rtf)$/i;
const LOCAL_DEPTH = 3;

/** Hint files already in the game folder, a few levels deep. */
function localHints(folder) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < LOCAL_DEPTH) walk(p, depth + 1);
      else if (e.isFile() && LOCAL_EXT.test(e.name) && LOCAL_NAME.test(e.name)) {
        out.push({ label: path.relative(folder, p), path: p, kind: 'file', source: 'Game folder' });
      }
    }
  };
  walk(folder, 0);
  return out;
}

/** Each game on the UHS list is an <li> with its title and a "View Hints" link. */
function parseUhsIndex(html) {
  const $ = cheerio.load(html);
  return $('li').toArray()
    .map((li) => ({
      title: $(li).find('span.hint-title').first().text().trim(),
      href: $(li).find('a[href^="/uhsweb/"]').first().attr('href'),
    }))
    .filter((e) => e.title && e.href);
}

let uhsMemo = null;

/** The UHS game list, from cache or downloaded once; concurrent lookups share one load. */
function loadUhsIndex(cacheFile) {
  if (uhsMemo) return uhsMemo;
  uhsMemo = (async () => {
    try {
      const st = fs.statSync(cacheFile);
      if (Date.now() - st.mtimeMs < UHS_MAX_AGE_MS) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      // No usable cache; fetch below.
    }
    const res = await politeFetch(UHS_INDEX_URL, { accept: 'text/html' });
    const index = parseUhsIndex(await res.text());
    fs.writeFileSync(cacheFile, JSON.stringify(index));
    return index;
  })();
  // A failed load is retried by the next lookup.
  uhsMemo.catch(() => { uhsMemo = null; });
  return uhsMemo;
}

/** UHS hint files whose title is this game; exact titles win over subtitled ones. */
function pickUhs(index, title) {
  const want = clean(title);
  const exact = index.filter((e) => clean(e.title) === want);
  return (exact.length ? exact : index.filter((e) => sameGame(e.title, title)))
    .map((e) => ({ label: `${e.title} hints`, url: `${UHS_BASE}${e.href}`, kind: 'web' }));
}

/** The StrategyWiki guide for a game, linking its walkthrough page when it has one. */
function pickStrategyWiki(titles, title) {
  const roots = [...new Set(titles.map((t) => t.split('/')[0]))].filter((r) => clean(r) === clean(title));
  return roots.map((root) => {
    const page = titles.includes(`${root}/Walkthrough`) ? `${root}/Walkthrough` : root;
    return { label: `${page} guide`, url: `https://strategywiki.org/wiki/${page.replace(/ /g, '_').split('/').map(encodeURIComponent).join('/')}`, kind: 'web' };
  });
}

async function fetchStrategyWiki(title) {
  const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', list: 'prefixsearch', pssearch: title, pslimit: '30' });
  const res = await politeFetch(`${STRATEGYWIKI_API}?${q}`, { accept: 'application/json' });
  const data = await res.json();
  return pickStrategyWiki(((data.query && data.query.prefixsearch) || []).map((p) => p.title), title);
}

/**
 * Collect hint guides for a game from every source.
 * @returns {{ hints: Array<{label, url?, path?, kind, source}>, warnings: string[] }}
 */
async function findHints({ title, folder, uhsIndexFile }) {
  const hints = folder ? localHints(folder) : [];
  const warnings = [];
  const sources = [
    ['Universal Hint System', async () => pickUhs(await loadUhsIndex(uhsIndexFile), title)],
    ['StrategyWiki', () => fetchStrategyWiki(title)],
    ['Internet Archive', () => fetchArchiveGuides({ title })],
  ];
  // Different hosts, so they're queried together.
  const results = await Promise.allSettled(sources.map(([, run]) => run()));
  results.forEach((r, i) => {
    const source = sources[i][0];
    if (r.status === 'fulfilled') for (const h of r.value) hints.push({ ...h, source });
    else warnings.push(`Hints from ${source}: ${r.reason.message}`);
  });
  return { hints, warnings };
}

module.exports = { findHints, localHints, parseUhsIndex, pickUhs, pickStrategyWiki };
