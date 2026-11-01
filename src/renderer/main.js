import { createApp } from 'vue';
import VibeUI from '@velkymx/vibeui';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import '@velkymx/vibeui/style.css';
import App from './App.vue';

// app.use(VibeUI) restores the saved color mode during install, before mount.
createApp(App).use(VibeUI).mount('#app');
