'use strict';

// Game descriptions from English Wikipedia through its public API: one search request that
// also returns each hit's short description and plain-text intro.

const { politeFetch } = require('./http');
const { sameGame, yearIn, yearClash } = require('./match');

const API = 'https://en.wikipedia.org/w/api.php';

/** True for a short description such as "1993 video game", not a series, company or person. */
function isGameArticle(description) {
  return /\bgame\b/i.test(description || '') && !/\b(series|franchise|board|card|tabletop|character|company|developer|publisher|engine)\b/i.test(description);
}

/** Pick the first search hit that is a game article for the wanted title and year. */
function pickPage(pages, title, year) {
  for (const p of [...pages].sort((a, b) => a.index - b.index)) {
    if (!p.extract || !isGameArticle(p.description) || !sameGame(p.title, title)) continue;
    const y = yearIn(p.description) || yearIn(p.extract);
    if (yearClash(y, year)) continue;
    return {
      description: p.extract.trim(),
      year: y,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    };
  }
  return null;
}

async function fetchWikipedia({ title, year }) {
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${title} video game`,
    gsrlimit: '8',
    prop: 'extracts|description',
    exintro: '1',
    explaintext: '1',
    exlimit: 'max',
    redirects: '1',
  });
  const res = await politeFetch(`${API}?${q}`, { accept: 'application/json' });
  const data = await res.json();
  return pickPage((data.query && data.query.pages) || [], title, year);
}

module.exports = { fetchWikipedia, pickPage, isGameArticle };
