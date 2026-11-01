<script setup>
import { computed, onMounted, ref } from 'vue';
import { useColorMode } from '@velkymx/vibeui';
import { api, state, toast, upsertGame, attempt, fmtPlaytime, primaryGenre, visibleGames, DESC_BY_DEFAULT } from './store.js';
import GameCard from './components/GameCard.vue';
import SidebarItem from './components/SidebarItem.vue';
import logo from '../../icon.png';
import GameDetail from './components/GameDetail.vue';
import SettingsDialog from './components/SettingsDialog.vue';

const view = ref('all');
const engine = ref(null);
const genre = ref(null);
const query = ref('');
const sortKey = ref('title');
const sortDir = ref(1);
const detailId = ref(null);
const settingsOpen = ref(false);

const { colorMode, toggleColorMode } = useColorMode();
// toggleColorMode cycles light → dark → auto.
const THEMES = { light: { icon: 'sun', label: 'Light' }, dark: { icon: 'moon-stars', label: 'Dark' }, auto: { icon: 'circle-half', label: 'System' } };
const theme = computed(() => THEMES[colorMode.value]);

const sortOptions = [
  { value: 'title', text: 'Title' },
  { value: 'year', text: 'Release year' },
  { value: 'genre', text: 'Genre' },
  { value: 'developer', text: 'Developer' },
  { value: 'publisher', text: 'Publisher' },
  { value: 'lastPlayed', text: 'Last played' },
  { value: 'playtime', text: 'Play time' },
  { value: 'added', text: 'Recently added' },
];

const present = computed(() => state.games.filter((g) => !g.missing));
const count = (fn) => present.value.filter(fn).length || '';

// Sidebar rows: compact, borderless, rounded buttons.
const navItem = (item, active) => ({ ...item, active, tag: 'button', class: 'border-0 rounded py-1' });

const viewItems = computed(() => [
  { key: 'all', text: 'All games', count: present.value.length },
  { key: 'favorites', text: 'Favorites', count: count((g) => g.favorite) },
  { key: 'recent', text: 'Recently played' },
  { key: 'unplayed', text: 'Never played' },
  { key: 'noyear', text: 'Needs release year', count: count((g) => !g.year) },
].map((i) => navItem(i, view.value === i.key)));

const engineItems = computed(() => [
  { key: 'dosbox', text: 'DOSBox Staging' },
  { key: 'scummvm', text: 'ScummVM' },
].map((i) => navItem({ ...i, count: count((g) => g.engine === i.key) }, engine.value === i.key)));

const genreItems = computed(() => {
  const counts = new Map();
  for (const g of present.value) {
    const pg = primaryGenre(g);
    if (pg) counts.set(pg, (counts.get(pg) || 0) + 1);
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, n]) => navItem({ key: name, text: name, count: n }, genre.value === name));
});

const games = computed(() => visibleGames({
  view: view.value, engine: engine.value, genre: genre.value, query: query.value, sortKey: sortKey.value, sortDir: sortDir.value,
}));
const hasFolders = computed(() => (state.settings.libraryFolders || []).length > 0);
const ascending = computed(() => (DESC_BY_DEFAULT.has(sortKey.value) ? -1 : 1) * sortDir.value > 0);
const fetching = computed(() => [
  state.metaPending && `metadata ${state.metaPending} left`,
  state.artPending && `box art ${state.artPending} left`,
].filter(Boolean).join(', '));

function selectView({ item }) {
  view.value = item.key;
  detailId.value = null;
}
function toggleEngine({ item }) {
  engine.value = engine.value === item.key ? null : item.key;
  detailId.value = null;
}
function toggleGenre({ item }) {
  genre.value = genre.value === item.key ? null : item.key;
  detailId.value = null;
}
function changeSort(key) {
  sortKey.value = key;
  sortDir.value = 1;
}

async function scan() {
  const res = await attempt(() => api.scan());
  if (!res) return;
  state.games = res.games;
  toast.success(`Scanned ${res.summary.total} games (${res.summary.added} new).`);
}

async function addFolder() {
  const res = await attempt(() => api.addFolder());
  if (!res) return;
  state.settings = res.settings;
  state.games = res.games;
  toast.success(`Found ${res.summary.total} games (${res.summary.added} new).`);
}

onMounted(async () => {
  api.on('game:changed', upsertGame);
  api.on('library:changed', (list) => { state.games = list; });
  api.on('library:blocked', ({ message }) => toast.error(message, { delay: 7000 }));
  api.on('game:exited', ({ id, secs }) => {
    const g = state.games.find((x) => x.id === id);
    if (g) toast.info(`${g.title} closed after ${fmtPlaytime(secs)}.`);
  });
  api.on('meta:halted', ({ hosts, message }) => {
    state.haltedHosts = hosts;
    toast.error(message, { delay: 7000 });
  });
  api.on('meta:progress', ({ pending }) => { state.metaPending = pending; });
  api.on('art:progress', ({ pending }) => { state.artPending = pending; });
  const init = await api.init();
  state.settings = init.settings;
  state.tools = init.tools;
  state.games = init.games;
});
</script>

<template>
  <div class="d-flex flex-column vh-100">
    <VibeNavbar :expand="true" class="border-bottom py-2">
      <VibeNavbarBrand class="d-flex align-items-center gap-2" role="button" @click="detailId = null">
        <img :src="logo" alt="" width="28" height="28" />
        RetroShelf
      </VibeNavbarBrand>
      <VibeRow :gutters="2" align-items="center" class="flex-grow-1 flex-nowrap">
        <VibeCol>
          <VibeFormInput v-model="query" type="search" placeholder="Search title, developer, genre, year…" aria-label="Search" @focus="detailId = null" />
        </VibeCol>
        <VibeCol cols="auto">
          <VibeFormSelect :model-value="sortKey" :options="sortOptions" aria-label="Sort by" @update:model-value="changeSort" />
        </VibeCol>
        <VibeCol cols="auto">
          <VibeButton variant="secondary" :aria-label="ascending ? 'Ascending' : 'Descending'" @click="sortDir *= -1"><VibeIcon :icon="ascending ? 'sort-up' : 'sort-down'" /></VibeButton>
        </VibeCol>
        <VibeCol v-if="fetching" cols="auto" class="small text-body-secondary">
          <VibeSpinner size="sm" tag="span" /> Fetching {{ fetching }}…
        </VibeCol>
        <VibeCol v-if="state.haltedHosts.length" cols="auto">
          <VibeBadge variant="warning">Skipping {{ state.haltedHosts.join(', ') }} (rate limited)</VibeBadge>
        </VibeCol>
        <VibeCol cols="auto">
          <VibeButton :action="scan"><VibeIcon icon="arrow-clockwise" /> Scan</VibeButton>
        </VibeCol>
        <VibeCol cols="auto">
          <VibeButton v-vibe-tooltip="{ title: `Theme: ${theme.label}`, placement: 'bottom' }" variant="secondary" :aria-label="`Theme: ${theme.label}`" @click="toggleColorMode"><VibeIcon :icon="theme.icon" /></VibeButton>
        </VibeCol>
        <VibeCol cols="auto">
          <VibeButton variant="secondary" @click="settingsOpen = true"><VibeIcon icon="gear" /> Settings</VibeButton>
        </VibeCol>
      </VibeRow>
    </VibeNavbar>

    <VibeContainer fluid class="flex-grow-1 overflow-hidden">
      <VibeRow :gutters="0" class="h-100">
        <VibeCol tag="aside" :cols="3" :xl="2" class="h-100 overflow-auto border-end px-2 py-3">
          <VibeListGroup flush :items="viewItems" @item-click="selectView">
            <template #item="{ item }"><SidebarItem :item="item" /></template>
          </VibeListGroup>
          <h2 class="small fw-semibold text-body-secondary text-uppercase px-3 mt-4 mb-1">Engine</h2>
          <VibeListGroup flush :items="engineItems" @item-click="toggleEngine">
            <template #item="{ item }"><SidebarItem :item="item" /></template>
          </VibeListGroup>
          <h2 class="small fw-semibold text-body-secondary text-uppercase px-3 mt-4 mb-1">Genres</h2>
          <VibeListGroup flush :items="genreItems" empty-text="None yet" @item-click="toggleGenre">
            <template #item="{ item }"><SidebarItem :item="item" /></template>
          </VibeListGroup>
        </VibeCol>

        <VibeCol tag="main" class="h-100 overflow-auto p-3">
          <GameDetail v-if="detailId" :id="detailId" @close="detailId = null" />
          <VibeRow v-else-if="!hasFolders" justify-content="center" class="mt-5">
            <VibeCol :cols="12" :md="8" :lg="6">
              <VibeCard title="Add your DOS games folder">
                <p>Point RetroShelf at a folder where each subfolder is a game. It will identify the games, fetch art, screenshots and descriptions, and build an optimized DOSBox Staging config for each.</p>
                <VibeButton :action="addFolder"><VibeIcon icon="folder-plus" /> Choose folder…</VibeButton>
              </VibeCard>
            </VibeCol>
          </VibeRow>
          <VibeRow v-else :gutters="3" :row-cols="2" :row-cols-md="3" :row-cols-lg="4" :row-cols-xxl="5">
            <VibeCol v-for="g in games" :key="g.id">
              <GameCard :game="g" @open="detailId = g.id" />
            </VibeCol>
          </VibeRow>
        </VibeCol>
      </VibeRow>
    </VibeContainer>
  </div>

  <SettingsDialog v-model="settingsOpen" />
  <VibeToastHost />
</template>
