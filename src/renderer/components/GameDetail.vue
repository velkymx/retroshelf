<script setup>
import { computed, ref, watch } from 'vue';
import { api, state, toast, attempt, updateGame, upsertGame, readFiles, play, fmtPlaytime, fmtWhen, primaryGenre } from '../store.js';
import TuningPanel from './TuningPanel.vue';
import LaunchPanel from './LaunchPanel.vue';
import EditDialog from './EditDialog.vue';

const props = defineProps({ id: { type: String, required: true } });
const emit = defineEmits(['close']);

const g = computed(() => state.games.find((x) => x.id === props.id));
const tab = ref('about');
const editOpen = ref(false);
const removeOpen = ref(false);
const shotIndex = ref(0);
const shotInput = ref(null);
const shotFiles = ref([]);
const shotError = ref('');

const metaBusy = computed(() => g.value.metaStatus === 'loading');
const artBusy = computed(() => g.value.artStatus === 'loading');
const subtitle = computed(() => [g.value.year, g.value.developer.split(',')[0], g.value.shortDescription || primaryGenre(g.value)].filter(Boolean).join(' · '));
const shots = computed(() => g.value.screenshots.map((s) => ({ src: s.url, alt: s.caption || g.value.title, caption: s.caption || (s.kind === 'upload' ? 'Your screenshot' : ''), file: s.file })));
// Captions go under the carousel; text drawn over pixel art is unreadable.
const slides = computed(() => shots.value.map(({ src, alt }) => ({ src, alt })));
const currentShot = computed(() => shots.value[shotIndex.value] || {});
const shotCaption = computed(() => [currentShot.value.caption, `${shotIndex.value + 1} of ${shots.value.length}`].filter(Boolean).join(' · '));
// Stay on a real slide after one is deleted.
watch(() => shots.value.length, (n) => { if (shotIndex.value >= n) shotIndex.value = Math.max(0, n - 1); });

const notice = computed(() => {
  const x = g.value;
  if (!x.year) return { variant: 'danger', text: 'Release year required. Set it in Edit info to tune and play this game.' };
  if (x.engine === 'dosbox' && !state.tools.dosbox) return { variant: 'danger', text: 'DOSBox Staging was not found. Install it or set its path in Settings.' };
  if (x.engine === 'scummvm' && !state.tools.scummvm) return { variant: 'danger', text: 'ScummVM is not installed — this game needs it. Install ScummVM (scummvm.org), then come back.' };
  if (x.metaStatus === 'error') return { variant: 'warning', text: `Couldn't fetch metadata: ${x.metaError}` };
  if (x.lookupWarnings.length) return { variant: 'warning', text: x.lookupWarnings.join(' · ') };
  return null;
});

const facts = computed(() => {
  const x = g.value;
  return [
    ['Released', x.released || x.year],
    ['Developer', x.developer],
    ['Publisher', x.publisher],
    ['Designer', x.designer],
    ['Genre', x.genre],
    ['Theme', x.theme],
    ['Perspective', x.perspective],
    ['Series', x.series],
    ['Modes', x.modes],
    ['Rating', x.rating],
    ['DOSBox compat', x.dosboxSupport],
    ['Engine', x.engine === 'scummvm' ? `ScummVM (${(x.scummvm && x.scummvm.gameId) || 'auto-detect'})` : `DOSBox Staging (${x.source === 'bundle' ? 'pre-packaged' : 'plain install'})`],
    ['Folder', x.folder],
  ].filter(([, v]) => v);
});

const reqs = computed(() => {
  const r = g.value.reqs;
  return r ? [['CPU', r.cpu], ['Memory', r.ram], ['Video', r.video], ['Sound', r.sound], ['Storage', r.storage]].filter(([, v]) => v) : [];
});

const links = computed(() => [
  g.value.abandonwareUrl ? { text: 'MyAbandonware', url: g.value.abandonwareUrl } : { text: 'Find on MyAbandonware', url: g.value.abandonwareSearchUrl },
  g.value.wikiUrl && { text: 'Wikipedia', url: g.value.wikiUrl },
  g.value.mobyUrl && { text: 'MobyGames', url: g.value.mobyUrl },
].filter(Boolean));

const hints = computed(() => g.value.hints.map((h) => ({ ...h, text: `${h.label}${h.kind === 'pdf' ? ' (PDF)' : ''}`, tag: 'button' })));

async function uploadShots(files) {
  if (!files.length) return;
  shotError.value = '';
  const view = await attempt(async () => api.addScreenshots(g.value.id, await readFiles(files)));
  shotInput.value?.clearFiles();
  if (!view) return;
  upsertGame(view);
  shotIndex.value = 0; // Uploads are listed first.
  toast.success(`Added ${files.length} screenshot${files.length === 1 ? '' : 's'}.`);
}

async function removeShot(file) {
  const view = await attempt(() => api.removeScreenshot(g.value.id, file));
  if (view) upsertGame(view);
}

function openHint({ item }) {
  if (item.kind === 'file') attempt(() => api.openHint(g.value.id, item.path));
  else api.openExternal(item.url);
}

async function removeGame() {
  const { id, title } = g.value;
  removeOpen.value = false;
  if (await attempt(() => api.removeGame(id)) === undefined) return;
  state.games = state.games.filter((x) => x.id !== id);
  emit('close');
  toast.success(`Removed ${title} from the library.`);
}
</script>

<template>
  <div v-if="g">
    <VibeButton variant="secondary" size="sm" class="mb-3" @click="emit('close')"><VibeIcon icon="arrow-left" /> Library</VibeButton>

    <VibeRow :gutters="4">
      <VibeCol :cols="12" :md="4" :lg="3" :xxl="2">
        <img v-if="g.cover" :src="g.cover" alt="" class="img-fluid rounded shadow" />
      </VibeCol>
      <VibeCol :cols="12" :md="8" :lg="9" :xxl="10">
        <h1 class="h2 mb-1">{{ g.title }}</h1>
        <p class="text-body-secondary mb-3">{{ subtitle }}</p>
        <VibeRow :gutters="2" class="mb-3">
          <VibeCol cols="auto">
            <VibeButton variant="success" :disabled="g.running || g.missing || !g.year" @click="play(g)"><VibeIcon :icon="g.running ? 'hourglass-split' : 'play-fill'" /> {{ g.running ? 'Running' : 'Play' }}</VibeButton>
          </VibeCol>
          <VibeCol cols="auto">
            <VibeButton variant="warning" :outline="!g.favorite" :aria-label="g.favorite ? 'Unfavorite' : 'Favorite'" @click="updateGame(g.id, { favorite: !g.favorite })"><VibeIcon :icon="g.favorite ? 'star-fill' : 'star'" /></VibeButton>
          </VibeCol>
          <VibeCol cols="auto" align-self="center">
            <VibeButtonGroup aria-label="Game actions">
              <VibeButton variant="secondary" @click="editOpen = true"><VibeIcon icon="pencil" /> Edit info</VibeButton>
              <VibeButton variant="secondary" @click="api.openFolder(g.id)"><VibeIcon icon="folder2-open" /> Open folder</VibeButton>
              <VibeButton variant="secondary" :loading="metaBusy" loading-text="Fetching…" @click="api.fetchMeta(g.id)"><VibeIcon icon="cloud-arrow-down" /> Refresh metadata</VibeButton>
              <VibeButton variant="secondary" :loading="artBusy" :disabled="metaBusy" loading-text="Refreshing…" @click="attempt(() => api.refreshBoxart(g.id))"><VibeIcon icon="image" /> Refresh box art</VibeButton>
            </VibeButtonGroup>
          </VibeCol>
          <VibeCol cols="auto" align-self="center">
            <VibeButton variant="danger" outline @click="removeOpen = true"><VibeIcon icon="trash" /> Remove</VibeButton>
          </VibeCol>
        </VibeRow>
        <VibeRow :gutters="4" class="mb-3">
          <VibeCol cols="auto"><div class="fw-bold">{{ fmtWhen(g.lastPlayed) }}</div><small class="text-body-secondary">Last played</small></VibeCol>
          <VibeCol cols="auto"><div class="fw-bold">{{ fmtPlaytime(g.playtimeSec) }}</div><small class="text-body-secondary">Play time</small></VibeCol>
          <VibeCol cols="auto"><div class="fw-bold">{{ g.playCount || 0 }}</div><small class="text-body-secondary">Launches</small></VibeCol>
        </VibeRow>
        <VibeAlert v-if="notice" :key="notice.text" :variant="notice.variant" subtle :message="notice.text" class="mb-0 py-2" />
      </VibeCol>
    </VibeRow>

    <VibeTabs v-model="tab" class="mt-4 mb-3">
      <VibeTab name="about" label="About">
        <p class="mt-3" style="white-space: pre-line; max-width: 75ch">{{ g.description || (metaBusy ? 'Fetching description…' : 'No description found.') }}</p>
        <p v-if="g.descriptionSource" class="small text-body-secondary">
          From <VibeLink v-if="g.descriptionUrl" :href="g.descriptionUrl" target="_blank">{{ g.descriptionSource }}</VibeLink><template v-else>{{ g.descriptionSource }}</template>
        </p>
      </VibeTab>
      <VibeTab name="screenshots" label="Screenshots">
        <VibeFileInput ref="shotInput" v-model="shotFiles" multiple drag-drop accept="image/*" :max-size="20 * 1024 * 1024" class="mt-3 mb-3"
          dropzone-text="Drop your own screenshots here or click to browse"
          :validation-state="shotError ? 'invalid' : null" :validation-message="shotError"
          @change="uploadShots" @invalid="(f) => (shotError = `Skipped ${f.map((x) => x.name).join(', ')}: not an image under 20 MB.`)" />
        <VibeRow v-if="shots.length" justify-content="center" class="mt-0">
          <VibeCol :cols="12" :xl="9">
            <VibeCarousel id="shot-carousel" :key="g.id + shots.length" v-model="shotIndex" :items="slides" :interval="false" />
            <VibeRow align-items="center" justify-content="between" class="mt-2">
              <VibeCol cols="auto" class="text-body-secondary">{{ shotCaption }}</VibeCol>
              <VibeCol v-if="currentShot.file" cols="auto">
                <VibeButton variant="danger" outline size="sm" @click="removeShot(currentShot.file)"><VibeIcon icon="trash" /> Delete this screenshot</VibeButton>
              </VibeCol>
            </VibeRow>
          </VibeCol>
        </VibeRow>
        <p v-else class="text-body-secondary">{{ metaBusy ? 'Fetching screenshots…' : 'No screenshots yet. Add your own above, or press Ctrl+F5 in DOSBox to capture them while playing.' }}</p>
      </VibeTab>
      <VibeTab name="details" label="Details">
        <VibeRow :gutters="3" class="mt-0">
          <VibeCol :cols="12" :xl="6">
            <VibeCard header="Game info" class="h-100">
              <dl class="row mb-3">
                <template v-for="[k, v] in facts" :key="k">
                  <dt class="col-sm-4 text-body-secondary fw-normal">{{ k }}</dt>
                  <dd class="col-sm-8 text-break">{{ v }}</dd>
                </template>
              </dl>
              <VibeRow :gutters="2">
                <VibeCol v-for="l in links" :key="l.url" cols="auto">
                  <VibeButton :href="l.url" target="_blank" variant="secondary" size="sm">{{ l.text }} <VibeIcon icon="box-arrow-up-right" /></VibeButton>
                </VibeCol>
              </VibeRow>
            </VibeCard>
          </VibeCol>
          <VibeCol :cols="12" :xl="6">
            <VibeCard header="System requirements" class="mb-3">
              <template v-if="reqs.length">
                <VibeBadge variant="secondary" class="mb-2">Original minimum (box)</VibeBadge>
                <dl class="row mb-0">
                  <template v-for="[k, v] in reqs" :key="k">
                    <dt class="col-sm-4 text-body-secondary fw-normal">{{ k }}</dt>
                    <dd class="col-sm-8">{{ v }}</dd>
                  </template>
                </dl>
              </template>
              <p v-else class="text-body-secondary mb-0">Not available.</p>
              <p v-if="g.profile" class="small text-body-secondary border-top pt-3 mt-3 mb-0">
                Emulated as <b>{{ g.profile.eraLabel }}</b>: {{ g.profile.cycles }} cycles real mode, {{ g.profile.cyclesProtected }} protected,
                {{ g.profile.memsize }} MB RAM, {{ g.profile.sbtype.toUpperCase() }}{{ g.profile.gus ? ' + GUS' : '' }}, {{ g.profile.shader }} shader.
              </p>
            </VibeCard>
            <VibeCard header="Hint guides" body-class="p-0">
              <VibeListGroup flush :items="hints" :empty-text="metaBusy ? 'Searching…' : 'No hint guides found.'" @item-click="openHint">
                <template #item="{ item }">
                  <span class="d-flex justify-content-between align-items-center gap-3 w-100">
                    <span class="text-truncate">{{ item.text }}</span>
                    <small class="text-body-secondary text-nowrap">{{ item.source }}</small>
                  </span>
                </template>
              </VibeListGroup>
            </VibeCard>
          </VibeCol>
        </VibeRow>
      </VibeTab>
      <VibeTab v-if="g.engine === 'dosbox'" name="tuning" label="DOSBox tuning">
        <TuningPanel :game="g" />
      </VibeTab>
      <VibeTab name="launch" label="Launch">
        <LaunchPanel :game="g" />
      </VibeTab>
    </VibeTabs>

    <EditDialog v-model="editOpen" :game="g" />
    <VibeModal v-model="removeOpen" :title="`Remove “${g.title}”?`" centered>
      <p class="mb-0">Its files stay on disk. You can restore it from Settings → Removed games.</p>
      <template #footer>
        <VibeButton variant="secondary" @click="removeOpen = false">Cancel</VibeButton>
        <VibeButton variant="danger" @click="removeGame">Remove</VibeButton>
      </template>
    </VibeModal>
  </div>
</template>

<style>
/* DOS screenshots are tiny; scale them up with crisp pixels. */
#shot-carousel .carousel-item img {
  image-rendering: pixelated;
}
</style>
