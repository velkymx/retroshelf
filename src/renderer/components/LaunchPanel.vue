<script setup>
import { computed, ref, watch } from 'vue';
import { state, toast, attempt, updateGame } from '../store.js';

const props = defineProps({ game: { type: Object, required: true } });

const exe = ref('');
const commands = ref('');

watch(() => JSON.stringify([props.game.id, props.game.exe, props.game.commands]), () => {
  exe.value = props.game.exe;
  commands.value = props.game.commands.join('\n');
}, { immediate: true });

const scummvm = computed(() => props.game.scummvm || {});
const pickExe = computed(() => props.game.source === 'raw' && props.game.executables.length > 0);
const exeOptions = computed(() => props.game.executables.map((x) => ({ value: x, text: x })));
const canReset = computed(() => props.game.commandsOverridden || (props.game.source === 'raw' && props.game.exe !== props.game.executables[0]));
const commandsLabel = computed(() => `Startup commands (run after mounting${props.game.source === 'bundle' ? ', taken from the bundled config' : ''})${props.game.commandsOverridden ? ' • customized' : ''}`);

async function save() {
  const g = props.game;
  const lines = commands.value.split('\n').map((l) => l.trim()).filter(Boolean);
  const exeChanged = pickExe.value && exe.value !== g.exe;
  const edited = lines.join('\n') !== g.commands.join('\n');
  const patch = {
    // A new exe regenerates the commands; otherwise keep any custom commands.
    commandsOverride: exeChanged ? null : edited || g.commandsOverridden ? lines : null,
  };
  if (pickExe.value) patch.exeOverride = exe.value;
  if (await attempt(() => updateGame(g.id, patch))) toast.success('Launch settings saved.');
}

function reset() {
  return attempt(() => updateGame(props.game.id, { exeOverride: null, commandsOverride: null }));
}
</script>

<template>
  <VibeRow class="mt-3">
    <VibeCol :cols="12" :xl="8">
      <template v-if="game.engine === 'scummvm'">
        <p>
          Runs in ScummVM with a generated config (OpenGL, aspect-correct, subtitles + speech, per-game save folder).
          Target: <code>{{ scummvm.gameId || 'auto-detect' }}</code> · Data: <code>{{ scummvm.dataPath }}</code>
        </p>
        <VibeAlert v-if="!state.tools.scummvm" variant="warning" subtle
          :message="state.tools.platform === 'darwin' ? 'ScummVM is not installed. Install it from scummvm.org or with: brew install --cask scummvm' : 'ScummVM is not installed. Install it from scummvm.org, then rescan or set its path in Settings.'" />
      </template>
      <template v-else>
        <VibeFormGroup v-if="pickExe" label="Executable" hide-optional>
          <VibeFormSelect v-model="exe" :options="exeOptions" />
        </VibeFormGroup>
        <VibeFormGroup :label="commandsLabel" hide-optional>
          <VibeFormTextarea v-model="commands" :rows="5" spellcheck="false" class="font-monospace" />
        </VibeFormGroup>
        <div class="d-flex gap-2">
          <VibeButton :action="save">Save launch settings</VibeButton>
          <VibeButton v-if="canReset" variant="secondary" :action="reset">Reset</VibeButton>
        </div>
      </template>
    </VibeCol>
  </VibeRow>
</template>
