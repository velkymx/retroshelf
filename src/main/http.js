'use strict';

// All metadata traffic goes through here: one request at a time per host, spaced out, and a
// hard stop for a host the moment it answers 429. A rate-limited host is never retried in
// this session unless the user explicitly asks (resetHost).

const USER_AGENT = 'RetroShelf/1.0 (personal DOS game library launcher)';
const MIN_GAP_MS = 2000;
// A stalled request would hold up the one-at-a-time metadata queue forever.
const DEFAULT_TIMEOUT_MS = 30000;

class RateLimitError extends Error {
  constructor(host) {
    super(`${host} is rate-limiting requests (HTTP 429). Metadata fetching from it is stopped.`);
    this.name = 'RateLimitError';
    this.host = host;
  }
}

const hosts = new Map(); // host -> { chain: Promise, last: number, halted: boolean }

function hostState(host) {
  if (!hosts.has(host)) hosts.set(host, { chain: Promise.resolve(), last: 0, halted: false });
  return hosts.get(host);
}

function isHalted(url) {
  return hostState(new URL(url).host).halted;
}

function resetHost(host) {
  hostState(host).halted = false;
}

function haltedHosts() {
  return [...hosts.entries()].filter(([, s]) => s.halted).map(([h]) => h);
}

/**
 * fetch() that queues per host, waits MIN_GAP_MS between requests and halts on 429.
 * `timeoutMs` covers the whole request including reading the body; 0 disables it.
 */
function politeFetch(url, { accept = '*/*', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const host = new URL(url).host;
  const st = hostState(host);
  const run = async () => {
    if (st.halted) throw new RateLimitError(host);
    const wait = st.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (st.halted) throw new RateLimitError(host);
    st.last = Date.now();
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: accept },
      signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (res.status === 429) {
      st.halted = true;
      throw new RateLimitError(host);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res;
  };
  const p = st.chain.then(run, run);
  st.chain = p.catch(() => {});
  return p;
}

module.exports = { politeFetch, RateLimitError, isHalted, resetHost, haltedHosts };
