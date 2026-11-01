'use strict';

const cheerio = require('cheerio');

/**
 * Plain text from an HTML fragment (cheerio decodes entities): paragraphs become blank-line
 * separated, line breaks are kept, other whitespace is collapsed.
 */
function htmlToText(html) {
  const $ = cheerio.load(`<body>${html || ''}</body>`);
  $('br').replaceWith('\n');
  const squash = (s) => s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  const paras = $('p').toArray().map((p) => squash($(p).text())).filter(Boolean);
  return paras.length ? paras.join('\n\n') : squash($('body').text());
}

module.exports = { htmlToText };
