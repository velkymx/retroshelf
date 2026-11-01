'use strict';

// Title matching shared by the description and hint sources. Titles are compared after
// libretro normalization (roman numerals, punctuation, leading articles) with tags such as
// "(1997)" or "(video game)" removed.

const { normalize } = require('./libretro');

function clean(s) {
  return normalize(String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, ''));
}

/** True when `rest`, the words after a matched title, would make it a numbered sequel. */
function isSequel(rest) {
  return /^\d{1,2}\b/.test(rest);
}

/**
 * True when `found` names the same game as `want`. A subtitle after the wanted title is
 * allowed ("Laura Bow 2: The Dagger of Amon Ra" for "Laura Bow 2"); a sequel number is not.
 */
function sameGame(found, want) {
  const f = clean(found);
  const w = clean(want);
  if (!f || !w) return false;
  if (f === w) return true;
  if (f.startsWith(`${w} `)) return !isSequel(f.slice(w.length + 1));
  return false;
}

/** True when a book or page title mentions `want` as a whole phrase and not a sequel of it. */
function mentionsGame(text, want) {
  const t = ` ${clean(text)} `;
  const w = clean(want);
  if (!w) return false;
  const i = t.indexOf(` ${w} `);
  return i >= 0 && !isSequel(t.slice(i + w.length + 2));
}

/** First plausible DOS-era year in a string. */
function yearIn(s) {
  const m = String(s || '').match(/\b(19[7-9]\d|200\d)\b/);
  return m ? Number(m[1]) : null;
}

/** True when both years are known and too far apart to be the same release. */
function yearClash(a, b) {
  return Boolean(a && b && Math.abs(a - b) > 2);
}

module.exports = { clean, sameGame, mentionsGame, yearIn, yearClash };
