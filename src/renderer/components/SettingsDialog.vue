<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, state, toast, attempt, upsertGame } from '../store.js';

const open = defineModel({ type: Boolean, default: false });

const TEXT_KEYS = ['dosboxPath', 'scummvmPath', 'soundfont', 'mt32RomDir', 'mobyApiKey', 'shader', 'integerScaling', 'midiPreference', 'reverb', 'chorus', 'crossfeed'];
const BOOL_KEYS = ['ignorePrimaryConf', 'fullscreen', 'scummvmFiltering', 'autoFetchMetadata'];

const opts = (pairs) => pairs.map(([value, text]) => ({ value, text: text || value }));
const OPTIONS = {
  shader: opts([['crt-auto', 'CRT (adaptive, authentic)'], ['crt-auto-machine', 'CRT (match emulated card)'], ['crt-auto-arcade', 'CRT (arcade, bold)'], ['crt-auto-arcade-sharp', 'CRT (arcade, sharp)'], ['sharp', 'Sharp pixels'], ['none', 'None (bilinear)']]),
  integerScaling: opts([['auto', 'Auto'], ['vertical', 'Vertical (pixel-perfect lines)'], ['off', 'Off (fill screen)']]),
  midiPreference: opts([['auto', 'General MIDI (SoundFont or system synth)'], ['mt32', 'Roland MT-32 when ROMs are present'], ['none', 'Off']]),
  reverb: opts([['off'], ['tiny'], ['small'], ['medium'], ['large']]),
  chorus: opts([['off'], ['light'], ['normal'], ['strong']]),
  crossfeed: opts([['off'], ['light'], ['normal'], ['strong']]),
};

const form = reactive({});
const tab = ref('library');
const removed = ref([]);
const reloadArtIndex = ref(false);

const t = computed(() => state.tools);
const detected = (path, none) => (path ? `Using ${path}` : none);
const folderItems = computed(() => (state.settings.libraryFolders || []).map((f) => ({ text: f })));
const removedItems = computed(() => removed.value.map((h) => ({ text: h.title, id: h.id })));

async function loadRemoved() {
  removed.value = await attempt(() => api.hiddenGames()) || [];
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  for (const k of TEXT_KEYS) form[k] = state.settings[k] ?? '';
  for (const k of BOOL_KEYS) form[k] = Boolean(state.settings[k]);
  reloadArtIndex.value = false;
  loadRemoved();
});

async function pick(key, directory = false) {
  const p = await attempt(() => api.pickFile({ directory }));
  if (p) form[key] = p;
}

async function addFolder() {
  const res = await attempt(() => api.addFolder());
  if (!res) return;
  state.settings = res.settings;
  state.games = res.games;
  toast.success(`Found ${res.summary.total} games (${res.summary.added} new).`);
}

async function removeFolder(folder) {
  const res = await attempt(() => api.removeFolder(folder));
  if (!res) return;
  state.settings = res.settings;
  state.games = res.games;
}

async function restore(item) {
  const res = await attempt(() => api.restoreGame(item.id));
  if (!res) return;
  upsertGame(res.game);
  await loadRemoved();
  toast.success(`Restored ${item.text}.`);
}

async function fetchMeta(onlyMissing) {
  const n = await attempt(() => api.fetchAllMeta(onlyMissing));
  if (n !== undefined) toast.info(`${onlyMissing ? 'Fetching' : 'Refreshing'} metadata for ${n} games…`);
}

async function refreshAllArt() {
  const n = await attempt(() => api.refreshAllBoxart(reloadArtIndex.value));
  if (n !== undefined) toast.info(`Refreshing box art for ${n} games…`);
}

async function save() {
  const patch = { ...form };
  for (const k of TEXT_KEYS) patch[k] = String(patch[k]).trim();
  const res = await attempt(() => api.updateSettings(patch));
  if (!res) return;
  state.settings = res.settings;
  state.tools = res.tools;
  open.value = false;
  toast.success('Settings saved.');
}
</script>

<template>
  <VibeModal v-model="open" title="Settings" size="xl" scrollable>
    <VibeTabs v-model="tab">
      <VibeTab name="library" label="Library">
        <h2 class="h6 mt-3">Library folders</h2>
        <VibeListGroup :items="folderItems" empty-text="No folders yet.">
          <template #item="{ item }">
            <span class="d-flex justify-content-between align-items-center w-100 gap-2">
              <span class="text-break">{{ item.text }}</span>
              <VibeButton variant="danger" outline size="sm" @click="removeFolder(item.text)">Remove</VibeButton>
            </span>
          </template>
        </VibeListGroup>
        <VibeButton class="mt-2" :action="addFolder">+ Add folder…</VibeButton>

        <h2 class="h6 mt-4">Removed games</h2>
        <p class="small text-body-secondary">Games you removed from the library. Their files are still on disk.</p>
        <VibeListGroup :items="removedItems" empty-text="None.">
          <template #item="{ item }">
            <span class="d-flex justify-content-between align-items-center w-100 gap-2">
              {{ item.text }}
              <VibeButton variant="secondary" size="sm" :action="() => restore(item)">Restore</VibeButton>
            </span>
          </template>
        </VibeListGroup>
      </VibeTab>

      <VibeTab name="emulators" label="Emulators">
        <div class="mt-3">
          <VibeFormGroup hide-optional label="DOSBox Staging executable" :help-text="detected(t.dosbox, 'Not found')">
            <VibeInputGroup>
              <VibeFormInput v-model="form.dosboxPath" placeholder="Auto-detect" no-wrapper />
              <template #append><VibeButton variant="secondary" @click="pick('dosboxPath')">Browse…</VibeButton></template>
            </VibeInputGroup>
          </VibeFormGroup>
          <VibeFormGroup hide-optional label="ScummVM executable" :help-text="detected(t.scummvm, 'Not found')">
            <VibeInputGroup>
              <VibeFormInput v-model="form.scummvmPath" placeholder="Auto-detect" no-wrapper />
              <template #append><VibeButton variant="secondary" @click="pick('scummvmPath')">Browse…</VibeButton></template>
            </VibeInputGroup>
          </VibeFormGroup>
          <VibeFormSwitch v-model="form.ignorePrimaryConf" label="Ignore my own dosbox-staging.conf (use only RetroShelf’s settings)" />
        </div>
      </VibeTab>

      <VibeTab name="av" label="Display & audio">
        <VibeRow :gutters-x="3" :row-cols="1" :row-cols-md="2" class="mt-3">
          <VibeCol><VibeFormGroup hide-optional label="Shader"><VibeFormSelect v-model="form.shader" :options="OPTIONS.shader" /></VibeFormGroup></VibeCol>
          <VibeCol><VibeFormGroup hide-optional label="Integer scaling"><VibeFormSelect v-model="form.integerScaling" :options="OPTIONS.integerScaling" /></VibeFormGroup></VibeCol>
          <VibeCol><VibeFormGroup hide-optional label="MIDI"><VibeFormSelect v-model="form.midiPreference" :options="OPTIONS.midiPreference" /></VibeFormGroup></VibeCol>
          <VibeCol><VibeFormGroup hide-optional label="Reverb"><VibeFormSelect v-model="form.reverb" :options="OPTIONS.reverb" /></VibeFormGroup></VibeCol>
          <VibeCol><VibeFormGroup hide-optional label="Chorus"><VibeFormSelect v-model="form.chorus" :options="OPTIONS.chorus" /></VibeFormGroup></VibeCol>
          <VibeCol><VibeFormGroup hide-optional label="Headphone crossfeed"><VibeFormSelect v-model="form.crossfeed" :options="OPTIONS.crossfeed" /></VibeFormGroup></VibeCol>
        </VibeRow>
        <VibeFormSwitch v-model="form.fullscreen" label="Start fullscreen" />
        <VibeFormSwitch v-model="form.scummvmFiltering" label="Smooth filtering in ScummVM" class="mb-3" />
        <VibeFormGroup hide-optional label="SoundFont (.sf2)" :help-text="detected(t.soundfont, 'None found (macOS uses the built-in system synth)')">
          <VibeInputGroup>
            <VibeFormInput v-model="form.soundfont" placeholder="Auto-detect from DOSBox soundfonts folder" no-wrapper />
            <template #append><VibeButton variant="secondary" @click="pick('soundfont')">Browse…</VibeButton></template>
          </VibeInputGroup>
        </VibeFormGroup>
        <VibeFormGroup hide-optional label="MT-32 ROM folder" :help-text="detected(t.mt32RomDir, 'None found')">
          <VibeInputGroup>
            <VibeFormInput v-model="form.mt32RomDir" placeholder="Auto-detect from DOSBox mt32-roms folder" no-wrapper />
            <template #append><VibeButton variant="secondary" @click="pick('mt32RomDir', true)">Browse…</VibeButton></template>
          </VibeInputGroup>
        </VibeFormGroup>
      </VibeTab>

      <VibeTab name="metadata" label="Metadata">
        <div class="mt-3">
          <VibeFormSwitch v-model="form.autoFetchMetadata" label="Fetch metadata automatically for new games" class="mb-3" />
          <VibeFormGroup hide-optional label="MobyGames API key" help-text="Adds more screenshots.">
            <VibeFormInput v-model="form.mobyApiKey" />
          </VibeFormGroup>
          <div class="d-flex flex-wrap gap-2">
            <VibeButton :action="() => fetchMeta(true)">Fetch missing metadata</VibeButton>
            <VibeButton variant="secondary" :action="() => fetchMeta(false)">Refresh all metadata</VibeButton>
            <VibeButton variant="secondary" @click="api.openConfigFolder()">Open generated configs</VibeButton>
          </div>
          <h2 class="h6 mt-4">Box art</h2>
          <VibeFormSwitch v-model="reloadArtIndex" label="Download the latest box art list first (picks up newly added covers)" class="mb-2" />
          <VibeButton :action="refreshAllArt">Refresh all box art</VibeButton>
        </div>
      </VibeTab>
    </VibeTabs>
    <template #footer>
      <VibeButton variant="secondary" @click="open = false">Cancel</VibeButton>
      <VibeButton :action="save">Save</VibeButton>
    </template>
  </VibeModal>
</template>
