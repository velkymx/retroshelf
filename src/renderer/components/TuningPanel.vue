<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, toast, attempt, updateGame } from '../store.js';

const props = defineProps({ game: { type: Object, required: true } });

const opts = (pairs) => pairs.map(([value, text]) => ({ value, text }));
const SHADERS = [['crt-auto', 'CRT (adaptive)'], ['crt-auto-machine', 'CRT (match card)'], ['crt-auto-arcade', 'CRT (arcade)'], ['crt-auto-arcade-sharp', 'CRT (arcade, sharp)'], ['sharp', 'Sharp pixels'], ['none', 'None']];

const FIELDS = [
  { key: 'era', label: 'Hardware era', options: () => Object.entries(props.game.eras) },
  { key: 'cycles', label: 'CPU cycles (real mode)', type: 'number' },
  { key: 'cyclesProtected', label: 'CPU cycles (protected mode)', type: 'text', hint: 'number, max or auto' },
  { key: 'memsize', label: 'Memory (MB)', type: 'number' },
  { key: 'core', label: 'CPU core', options: () => [['auto', 'auto'], ['normal', 'normal'], ['dynamic', 'dynamic (fast)']] },
  { key: 'machine', label: 'Video card', options: () => [['svga_s3', 'S3 SVGA (default)'], ['vesa_nolfb', 'VESA, no LFB'], ['svga_et4000', 'Tseng ET4000'], ['svga_paradise', 'Paradise PVGA1A'], ['vgaonly', 'VGA only'], ['ega', 'EGA'], ['cga', 'CGA'], ['tandy', 'Tandy'], ['pcjr', 'PCjr'], ['hercules', 'Hercules']] },
  { key: 'mouse', label: 'Mouse capture', options: () => [['onclick', 'On click (action games)'], ['seamless', 'Seamless (point & click)'], ['onstart', 'On start'], ['nomouse', 'No mouse']] },
  { key: 'shader', label: 'Shader', options: () => SHADERS },
  { key: 'integerScaling', label: 'Integer scaling', options: () => [['auto', 'auto'], ['vertical', 'vertical'], ['off', 'off']] },
  { key: 'fullscreen', label: 'Fullscreen', options: () => [['true', 'On'], ['false', 'Off']] },
  { key: 'sbtype', label: 'Sound Blaster', options: () => [['sb16', 'Sound Blaster 16'], ['sbpro2', 'SB Pro 2'], ['sbpro1', 'SB Pro'], ['sb2', 'SB 2.0'], ['sb1', 'SB 1.0'], ['gb', 'Game Blaster'], ['none', 'None']] },
  { key: 'gus', label: 'Gravis Ultrasound', options: () => [['false', 'Off'], ['true', 'On']] },
  { key: 'midi', label: 'MIDI synth', options: () => [['auto', 'General MIDI'], ['mt32', 'Roland MT-32'], ['none', 'Off']] },
];

const values = reactive({});
const initial = {};
const config = ref(null);

const profile = computed(() => props.game.profile);
const isOverridden = (key) => Object.prototype.hasOwnProperty.call(props.game.overrides, key);

/** Select options, plus the current value when it isn't one of them. */
function selectOptions(f) {
  const list = opts(f.options());
  const current = initial[f.key];
  return list.some((o) => o.value === current) ? list : [...list, { value: current, text: current }];
}

// Reload the form whenever the saved profile or overrides change.
watch(() => JSON.stringify([props.game.id, profile.value, props.game.overrides]), () => {
  if (!profile.value) return;
  for (const f of FIELDS) {
    initial[f.key] = String(profile.value[f.key]);
    values[f.key] = initial[f.key];
  }
}, { immediate: true });

function parse(key, raw) {
  if (key === 'cycles' || key === 'memsize') return Number(raw);
  if (key === 'cyclesProtected') return /^\d+$/.test(raw) ? Number(raw) : raw;
  if (key === 'gus' || key === 'fullscreen') return raw === 'true';
  return raw;
}

async function refreshConfig() {
  if (config.value !== null) config.value = await attempt(() => api.previewConfig(props.game.id)) ?? null;
}

async function save() {
  const changed = (k) => String(values[k]).trim() !== initial[k];
  const overrides = { ...props.game.overrides };
  for (const f of FIELDS) if (changed(f.key)) overrides[f.key] = parse(f.key, String(values[f.key]).trim());
  if (overrides.cyclesProtected !== undefined && !/^(\d+|max|auto)$/.test(String(overrides.cyclesProtected))) {
    toast.error('Protected-mode cycles must be a number, "max" or "auto".');
    return;
  }
  // Changing the era re-derives cycles/memory from it unless those were also changed.
  if (overrides.era && overrides.era !== props.game.overrides.era) {
    for (const k of ['cycles', 'cyclesProtected', 'memsize', 'core']) if (!changed(k)) delete overrides[k];
  }
  if (!await attempt(() => updateGame(props.game.id, { overrides }))) return;
  await refreshConfig();
  toast.success('Tuning saved.');
}

async function reset() {
  if (!await attempt(() => updateGame(props.game.id, { overrides: {} }))) return;
  await refreshConfig();
  toast.success('Back to the recommended profile.');
}

async function toggleConfig() {
  config.value = config.value === null ? await attempt(() => api.previewConfig(props.game.id)) ?? null : null;
}
</script>

<template>
  <div class="mt-3">
    <p v-if="!profile" class="text-body-secondary">This game needs its release year before it can be tuned. Set it in Edit info.</p>
    <template v-else>
      <p class="text-body-secondary">Recommended profile: {{ profile.eraLabel }}. Fields you change are saved as overrides for this game only (marked •).</p>
      <VibeRow :gutters-x="3" :row-cols="1" :row-cols-md="2" :row-cols-xl="3">
        <VibeCol v-for="f in FIELDS" :key="f.key">
          <VibeFormGroup :label="f.label + (isOverridden(f.key) ? ' •' : '')" hide-optional>
            <VibeFormSelect v-if="f.options" v-model="values[f.key]" :options="selectOptions(f)" />
            <VibeFormInput v-else v-model="values[f.key]" :type="f.type" :placeholder="f.hint" />
          </VibeFormGroup>
        </VibeCol>
      </VibeRow>
      <div class="d-flex gap-2">
        <VibeButton :action="save">Save tuning</VibeButton>
        <VibeButton variant="secondary" :action="reset">Reset to recommended</VibeButton>
        <VibeButton variant="secondary" :action="toggleConfig">{{ config === null ? 'View generated config' : 'Hide generated config' }}</VibeButton>
      </div>
      <pre v-if="config !== null" class="mt-3 p-3 bg-body-tertiary rounded small">{{ config }}</pre>
    </template>
  </div>
</template>
