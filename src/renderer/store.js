import { reactive } from 'vue';
import { useToast } from '@velkymx/vibeui';

export const api = window.shelf;
export const toast = useToast();

export const state = reactive({
  games: [],
  settings: {},
  tools: {},
  metaPending: 0,
  artPending: 0,
  haltedHosts: [],
});

export function errMsg(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Run an IPC call, turning a rejection into an error toast. */
export async function attempt(fn) {
  try {
    return await fn();
  } catch (err) {
    toast.error(errMsg(err), { delay: 7000 });
    return undefined;
  }
}

export function upsertGame(view) {
  const i = state.games.findIndex((g) => g.id === view.id);
  if (i >= 0) state.games[i] = view; else state.games.push(view);
}

export async function updateGame(id, patch) {
  const view = await api.updateGame(id, patch);
  upsertGame(view);
  return view;
}

/** Read picked files into { name, data } for the main process to save. */
export function readFiles(files) {
  return Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
}

export async function play(g) {
  if (!g.year) {
    toast.error(`${g.title}: release year required. Set it in Edit info.`);
    return;
  }
  if (await attempt(() => api.launch(g.id)) !== undefined) toast.info(`Launching ${g.title}…`);
}

export function fmtPlaytime(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h} h ${m} m` : `${Math.max(m, 1)} m`;
}

export function fmtWhen(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return d.toLocaleDateString();
}

export function primaryGenre(g) {
  return (g.genre || '').split(/[,/]/)[0].trim();
}

const sortTitle = (t) => t.replace(/^(the|a|an)\s+/i, '').toLowerCase();

// Keys whose natural order is "biggest/newest first".
export const DESC_BY_DEFAULT = new Set(['lastPlayed', 'playtime', 'added']);

const SORT_VALUE = {
  title: (g) => sortTitle(g.title),
  year: (g) => g.year || null,
  genre: (g) => primaryGenre(g).toLowerCase() || null,
  developer: (g) => (g.developer || '').toLowerCase() || null,
  publisher: (g) => (g.publisher || '').toLowerCase() || null,
  lastPlayed: (g) => g.lastPlayed || null,
  playtime: (g) => g.playtimeSec || null,
  added: (g) => g.addedAt || null,
};

const VIEW_FILTER = {
  all: () => true,
  favorites: (g) => g.favorite,
  recent: (g) => g.lastPlayed,
  unplayed: (g) => !g.playCount,
  noyear: (g) => !g.year,
};

/** Filter by sidebar selection and search, then sort. Title hits rank above description-only hits. */
export function visibleGames({ view, engine, genre, query, sortKey, sortDir }) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = state.games.filter((g) => !g.missing
    && VIEW_FILTER[view](g)
    && (!engine || g.engine === engine)
    && (!genre || primaryGenre(g) === genre)
    && terms.every((t) => [g.title, g.folderName, g.developer, g.publisher, g.genre, g.theme, g.year, g.series, g.description].join(' ').toLowerCase().includes(t)));
  const key = view === 'recent' && sortKey === 'title' ? 'lastPlayed' : sortKey;
  const dir = (DESC_BY_DEFAULT.has(key) ? -1 : 1) * sortDir;
  const val = SORT_VALUE[key];
  list.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    // Empty values always sink to the bottom, whatever the direction.
    if (va === null || vb === null) return (va === null) - (vb === null) || sortTitle(a.title).localeCompare(sortTitle(b.title));
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return c * dir || sortTitle(a.title).localeCompare(sortTitle(b.title));
  });
  if (!terms.length) return list;
  const titleHit = (g) => terms.every((t) => g.title.toLowerCase().includes(t));
  return list.sort((a, b) => titleHit(b) - titleHit(a));
}
