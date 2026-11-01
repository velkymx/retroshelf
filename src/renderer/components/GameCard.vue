<script setup>
import { computed } from 'vue';
import { play, primaryGenre } from '../store.js';

const props = defineProps({ game: { type: Object, required: true } });
defineEmits(['open']);

const meta = computed(() => [primaryGenre(props.game), props.game.developer.split(',')[0]].filter(Boolean).join(' · ') || props.game.folderName);
const busy = computed(() => props.game.metaStatus === 'loading' || props.game.artStatus === 'loading');
</script>

<template>
  <VibeCard class="h-100" body-class="px-3 py-2" role="button" tabindex="0" @click="$emit('open')" @dblclick="play(game)" @keydown.enter="$emit('open')">
    <template #image>
      <div class="position-relative ratio" style="--bs-aspect-ratio: 133%">
        <img v-if="game.cover" :src="game.cover" alt="" loading="lazy" class="card-img-top" :style="{ objectFit: game.hasRealCover ? 'cover' : 'contain' }" />
        <div v-else class="d-flex align-items-center justify-content-center text-center p-2 bg-body-tertiary">{{ game.title }}</div>
        <div class="position-absolute top-0 start-0 end-0 d-flex justify-content-between p-2" style="height: auto">
          <VibeBadge :variant="game.year ? 'dark' : 'warning'">{{ game.year || 'Year needed' }}</VibeBadge>
          <VibeBadge v-if="game.running" variant="success"><VibeIcon icon="play-fill" /> Running</VibeBadge>
          <VibeBadge v-else-if="busy" variant="secondary"><VibeIcon icon="cloud-arrow-down" aria-label="Fetching" /></VibeBadge>
          <VibeBadge v-else-if="game.favorite" variant="warning"><VibeIcon icon="star-fill" aria-label="Favorite" /></VibeBadge>
        </div>
      </div>
    </template>
    <template #title>
      <span class="d-block text-truncate fs-6 fw-semibold">{{ game.title }}</span>
    </template>
    <div class="small text-body-secondary text-truncate">{{ meta }}</div>
  </VibeCard>
</template>
