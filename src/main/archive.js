'use strict';

// Internet Archive: game descriptions from its MS-DOS software library, and scanned hint
// books, walkthroughs and strategy guides from its texts collection. Both use the public
// advanced search API; guide PDFs are found through the item metadata API.

const { politeFetch } = require('./http');
const { htmlToText } = require('./html');
const { sameGame, mentionsGame, yearClash } = require('./match');

const BASE = 'https://archive.org';
const GUIDE_WORDS = 'hint OR hints OR hintbook OR walkthrough OR solution OR solutions OR guide OR clue OR cluebook OR secrets OR strategies';
const MAX_GUIDES = 4;

/** Search terms for a title: plain words only, so Lucene syntax in a title can't break the query. */
function terms(title) {
  return String(title).replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).join(' ');
}

async function search(q, fields, rows) {
  const params = new URLSearchParams({ q, rows: String(rows), output: 'json' });
  for (const f of fields) params.append('fl[]', f);
  const res = await politeFetch(`${BASE}/advancedsearch.php?${params}`, { accept: 'application/json' });
  const data = await res.json();
  return (data.response && data.response.docs) || [];
}

/**
 * Clean an item description: strip markup, drop the MobyGames credit header and footer
 * that many items carry, and reject descriptions that only describe the upload.
 */
function cleanDescription(raw) {
  let s = htmlToText(Array.isArray(raw) ? raw.join('<br>') : raw);
  const body = s.match(/\bReleased\b[\s\S]*?\bDescription\s+([\s\S]+)/);
  if (body) s = body[1];
  s = s.replace(/\s*From Mobygames\.com[\s\S]*$/i, '').trim();
  if (/^this is (version|an alternative|the shareware|a demo)/i.test(s)) return '';
  return s;
}

/** Pick the MS-DOS library item for a title and year. */
function pickGame(docs, title, year) {
  const hits = docs
    .filter((d) => sameGame(d.title, title) && !yearClash(Number(d.year) || null, year))
    .map((d) => ({ ...d, description: cleanDescription(d.description) }))
    .filter((d) => d.description);
  hits.sort((a, b) => Number(Number(b.year) === year) - Number(Number(a.year) === year));
  const d = hits[0];
  return d ? { description: d.description, year: Number(d.year) || null, url: `${BASE}/details/${d.identifier}` } : null;
}

async function fetchArchiveGame({ title, year }) {
  const docs = await search(
    `title:(${terms(title)}) AND (collection:softwarelibrary_msdos_games OR collection:softwarelibrary_msdos)`,
    ['identifier', 'title', 'year', 'description'],
    25,
  );
  return pickGame(docs, title, year);
}

/** Guide books that are about this game: the title names it and reads like a guide. */
function pickGuides(docs, title) {
  return docs
    .filter((d) => mentionsGame(d.title, title))
    .filter((d) => /hint|walkthrough|solution|strateg|guide|clue|secret/i.test(d.title) && !/install|reference card|quick ?start/i.test(d.title))
    .slice(0, MAX_GUIDES);
}

/** The first downloadable (not lending-only) PDF in an item, if any. */
function pickPdf(files) {
  const pdf = (files || []).find((f) => /\.pdf$/i.test(f.name) && !f.private);
  return pdf ? pdf.name : null;
}

/** Hint books and guides for a game; each links its PDF when one can be downloaded. */
async function fetchArchiveGuides({ title }) {
  const docs = await search(`title:(${terms(title)}) AND title:(${GUIDE_WORDS}) AND mediatype:texts`, ['identifier', 'title'], 20);
  const out = [];
  for (const d of pickGuides(docs, title)) {
    const page = `${BASE}/details/${d.identifier}`;
    const res = await politeFetch(`${BASE}/metadata/${encodeURIComponent(d.identifier)}/files`, { accept: 'application/json' });
    const pdf = pickPdf((await res.json()).result);
    out.push(pdf
      ? { label: d.title, url: `${BASE}/download/${encodeURIComponent(d.identifier)}/${pdf.split('/').map(encodeURIComponent).join('/')}`, kind: 'pdf', page }
      : { label: `${d.title} (borrow)`, url: page, kind: 'web' });
  }
  return out;
}

module.exports = { fetchArchiveGame, fetchArchiveGuides, cleanDescription, pickGame, pickGuides, pickPdf, terms };
