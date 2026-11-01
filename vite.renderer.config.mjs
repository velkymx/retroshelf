import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Builds only the renderer (Vue + VibeUI). The main process and preload stay plain CommonJS.
export default defineConfig({
  root: fileURLToPath(new URL('src/renderer', import.meta.url)),
  // Relative asset URLs, because the window loads the build over file://.
  base: './',
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL('dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
});
