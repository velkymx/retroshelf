'use strict';

// MyAbandonware game pages over plain HTTP, parsed with cheerio. Its search sits behind a
// browser check, so pages are only read from a URL the user pasted (or a curated one); the
// UI links the search so the user can find the page in their own browser.

const cheerio = require('cheerio');
const { politeFetch } = require('./http');

const BASE = 'https://www.myabandonware.com';

async function getHtml(url) {
  const res = await politeFetch(url, { accept: 'text/html' });
  return { html: await res.text(), url: res.url };
}

function squash(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function isBrowserCheck(html) {
  return /^Please wait/i.test(cheerio.load(html)('title').text().trim());
}

function parseGamePage(html, pageUrl) {
  const $ = cheerio.load(html);
  const info = {};
  $('table.gameInfo tr').each((_, tr) => {
    const key = squash($(tr).find('th').text()).toLowerCase();
    if (key) info[key] = squash($(tr).find('td').text());
  });

  // Older pages wrap the description in a div; current ones put it under "Description of …".
  let paras = $('div.gameDescription p');
  if (!paras.length) {
    const heading = $('h3').filter((_, h) => /^Description of/i.test($(h).text().trim())).first();
    paras = heading.nextUntil('h3, h4').filter('p');
  }
  const description = paras.toArray()
    .map((p) => squash($(p).text()))
    .filter((t) => t && !/^Review By/i.test(t))
    .join('\n\n');

  // Prefer the DOS screenshot tab when a game spans several platforms.
  const dosTab = $('#screentabs a').filter((_, a) => $(a).text().trim() === 'DOS').attr('data-platform');
  const screens = dosTab ? $(`div.items.screens[data-platform="${dosTab}"]`) : $.root();
  const abs = (href) => new URL(href, BASE).toString();
  const shots = screens.find('a.itemListScreenshot').toArray().map((a) => abs($(a).attr('href')));
  const covers = $('a[href^="/media/covers/"]').toArray().map((a) => abs($(a).attr('href')));

  let ld = {};
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).text());
      if (j['@type'] === 'VideoGame') ld = j;
    } catch {
      // Ignore malformed blocks.
    }
  });
  const title = squash($('div.box > h2').first().text()) || ld.name || '';
  return {
    source: 'myabandonware',
    abandonwareUrl: pageUrl,
    title,
    description,
    year: Number(info.year) || Number(ld.datePublished) || null,
    genre: info.genre || (ld.genre || []).join(', '),
    theme: info.theme || '',
    publisher: info.publisher || (ld.publisher || []).join(', '),
    developer: info.developer || (ld.author || []).join(', '),
    perspective: info.perspective || '',
    dosboxSupport: info['dosbox support'] || '',
    rating: ld.aggregateRating ? `${ld.aggregateRating.ratingValue}/5 (${ld.aggregateRating.ratingCount} votes)` : '',
    coverUrl: covers[0] || null,
    screenshotUrls: shots.map((u) => ({ url: u, caption: '' })),
  };
}

function searchUrl(title) {
  return `${BASE}/search/q/${encodeURIComponent(title.replace(/[:'!?]/g, ' ').replace(/\s+/g, ' ').trim())}`;
}

/** Read a MyAbandonware game page. Returns null when the page answers with a browser check. */
async function fetchMyAbandonware({ url }) {
  const page = await getHtml(url);
  if (isBrowserCheck(page.html)) return null;
  return parseGamePage(page.html, page.url);
}

module.exports = { fetchMyAbandonware, parseGamePage, searchUrl, isBrowserCheck };
