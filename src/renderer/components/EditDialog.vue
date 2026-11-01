<script setup>
import { computed, ref, watch } from 'vue';
import { useForm, validators, useDebouncedRef } from '@velkymx/vibeui';
import { api, toast, attempt, updateGame, upsertGame, readFiles } from '../store.js';

const open = defineModel({ type: Boolean, default: false });
const props = defineProps({ game: { type: Object, required: true } });

const YEAR_SOURCE_LABEL = { user: 'set by you', metadata: 'from fetched metadata', curated: 'from RetroShelf’s game list' };

const form = useForm({ userTitle: '', userYear: '', userGenre: '', userDescription: '', userBoxartName: '', userAbandonwareUrl: '' });
const tab = ref('info');
const coverInput = ref(null);
const coverFiles = ref([]);
const coverError = ref('');
const rules = computed(() => ({
  userYear: [
    validators.required('Release year is required'),
    validators.min(props.game.yearRange[0], `Year must be ${props.game.yearRange[0]} or later`),
    validators.max(props.game.yearRange[1], `Year must be ${props.game.yearRange[1]} or earlier`),
  ],
  userAbandonwareUrl: [validators.pattern(/^https:\/\/(www\.)?myabandonware\.com\/game\//i, 'Should look like https://www.myabandonware.com/game/…')],
}));

const boxartQuery = ref('');
const boxartSearch = useDebouncedRef('', 200);
watch(boxartQuery, (q) => { boxartSearch.value = q; });
const candidates = ref([]);

const yearHelp = computed(() => (props.game.year ? `Year ${YEAR_SOURCE_LABEL[props.game.yearSource]}.` : 'Required — not found in metadata.'));
const boxartOptions = computed(() => {
  const chosen = props.game.userBoxartName;
  const names = candidates.value.map((c) => c.name);
  // Keep the current pick visible even if the search no longer returns it.
  if (chosen && !names.includes(chosen)) names.unshift(chosen);
  const auto = `(automatic${props.game.boxartName && !chosen ? `: ${props.game.boxartName}` : ''})`;
  return [{ value: '', text: auto }, ...names.map((n) => ({ value: n, text: n }))];
});

async function loadCandidates(query) {
  candidates.value = await attempt(() => api.boxartCandidates(props.game.id, query)) || [];
}

watch(open, (isOpen) => {
  if (!isOpen) return;
  const g = props.game;
  form.reset();
  form.setField('userTitle', g.title);
  form.setField('userYear', g.year || '');
  form.setField('userBoxartName', g.userBoxartName || '');
  form.setField('userAbandonwareUrl', g.userAbandonwareUrl || '');
  form.setField('userGenre', g.userGenre);
  form.setField('userDescription', g.userDescription);
  tab.value = 'info';
  coverError.value = '';
  boxartQuery.value = '';
  loadCandidates('');
});
watch(boxartSearch, (q) => { if (open.value) loadCandidates(q.trim()); });

// Box art uploads apply right away; they aren't part of Save.
async function uploadCover(files) {
  if (!files.length) return;
  coverError.value = '';
  const [file] = await readFiles(files);
  const view = await attempt(() => api.setCover(props.game.id, file));
  coverInput.value?.clearFiles();
  if (!view) return;
  upsertGame(view);
  toast.success('Box art updated.');
}

async function clearCover() {
  const view = await attempt(() => api.clearCover(props.game.id));
  if (view) upsertGame(view);
}

async function save() {
  const { valid } = await form.validate(rules.value);
  if (!valid) {
    tab.value = form.errors.userYear ? 'info' : 'sources';
    return;
  }
  const g = props.game;
  const f = form.fields;
  const year = Number(f.userYear);
  const patch = {
    userTitle: f.userTitle.trim() || null,
    userBoxartName: f.userBoxartName || null,
    userAbandonwareUrl: f.userAbandonwareUrl.trim() || null,
    // Blank means "use the fetched text".
    userGenre: f.userGenre.trim() || null,
    userDescription: f.userDescription.trim() || null,
  };
  // Only store the year as yours when you typed one that differs, or it was already yours.
  if (g.yearSource === 'user' || year !== g.year) patch.userYear = year;
  open.value = false;
  if (await attempt(() => updateGame(g.id, patch))) attempt(() => api.fetchMeta(g.id));
}
</script>

<template>
  <VibeModal v-model="open" title="Edit game info" size="lg" scrollable>
    <form @submit.prevent="save">
      <VibeTabs v-model="tab">
        <VibeTab name="info" label="Info">
          <VibeRow :gutters-x="3" class="mt-3">
            <VibeCol :cols="12" :md="8">
              <VibeFormGroup hide-optional label="Title">
                <VibeFormInput v-model="form.fields.userTitle" />
              </VibeFormGroup>
            </VibeCol>
            <VibeCol :cols="12" :md="4">
              <VibeFormGroup hide-optional label="Release year" required :help-text="yearHelp"
                :validation-state="form.errors.userYear ? 'invalid' : null" :validation-message="form.errors.userYear">
                <VibeFormInput v-model="form.fields.userYear" type="number" @validate="form.validateField('userYear', rules.userYear)" />
              </VibeFormGroup>
            </VibeCol>
          </VibeRow>
          <VibeFormGroup hide-optional label="Genres" help-text="Comma-separated. The first one is the sidebar category. Leave blank to use the fetched genres.">
            <VibeFormInput v-model="form.fields.userGenre" :placeholder="game.fetchedGenre || 'e.g. Adventure, Puzzle'" />
          </VibeFormGroup>
          <VibeFormGroup hide-optional label="Description" help-text="Leave blank to use the fetched description.">
            <VibeFormTextarea v-model="form.fields.userDescription" :rows="8" :placeholder="game.userDescription ? '' : game.description" />
          </VibeFormGroup>
        </VibeTab>

        <VibeTab name="art" label="Box art">
          <VibeRow :gutters="3" class="mt-0">
            <VibeCol :cols="12" :md="4">
              <img v-if="game.cover" :src="game.cover" alt="" class="w-100 rounded" />
              <VibeButton v-if="game.hasUserCover" variant="secondary" size="sm" class="mt-2 w-100" :action="clearCover">
                <VibeIcon icon="arrow-counterclockwise" /> Use downloaded box art
              </VibeButton>
            </VibeCol>
            <VibeCol :cols="12" :md="8">
              <VibeFormGroup hide-optional label="Your own box art" help-text="PNG, JPEG, GIF, BMP or WebP up to 20 MB. Applies right away."
                :validation-state="coverError ? 'invalid' : null" :validation-message="coverError">
                <VibeFileInput ref="coverInput" v-model="coverFiles" drag-drop accept="image/*" :max-size="20 * 1024 * 1024"
                  dropzone-text="Drop an image here or click to browse"
                  @change="uploadCover" @invalid="(f) => (coverError = `${f[0].name} isn't an image under 20 MB.`)" />
              </VibeFormGroup>
              <VibeFormGroup hide-optional label="Downloaded box art" help-text="libretro-thumbnails DOS set. Search, then pick the right match.">
                <VibeFormInput v-model="boxartQuery" type="search" placeholder="Search box art…" autocomplete="off" class="mb-2" />
                <VibeFormSelect v-model="form.fields.userBoxartName" :options="boxartOptions" :html-size="6" aria-label="Box art match" />
              </VibeFormGroup>
            </VibeCol>
          </VibeRow>
        </VibeTab>

        <VibeTab name="sources" label="Sources">
          <VibeFormGroup hide-optional label="MyAbandonware game page URL" help-text="Used for description and screenshots." class="mt-3"
            :validation-state="form.errors.userAbandonwareUrl ? 'invalid' : null" :validation-message="form.errors.userAbandonwareUrl">
            <VibeInputGroup>
              <VibeFormInput v-model="form.fields.userAbandonwareUrl" placeholder="https://www.myabandonware.com/game/…" no-wrapper
                @validate="form.validateField('userAbandonwareUrl', rules.userAbandonwareUrl)" />
              <template #append>
                <VibeButton variant="secondary" :href="game.abandonwareSearchUrl" target="_blank">Search site <VibeIcon icon="box-arrow-up-right" /></VibeButton>
              </template>
            </VibeInputGroup>
          </VibeFormGroup>
        </VibeTab>
      </VibeTabs>
    </form>
    <template #footer>
      <VibeButton variant="secondary" @click="open = false">Cancel</VibeButton>
      <VibeButton @click="save">Save &amp; refresh metadata</VibeButton>
    </template>
  </VibeModal>
</template>
