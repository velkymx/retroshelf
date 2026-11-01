<script setup>
defineProps({ item: { type: Object, required: true } });
</script>

<template>
  <span class="d-flex justify-content-between align-items-center gap-2 w-100">
    <span class="text-truncate" :title="item.text">{{ item.text }}</span>
    <VibeBadge v-if="item.count" :variant="item.active ? 'light' : 'secondary'" pill>{{ item.count }}</VibeBadge>
  </span>
</template>
