import { createApp } from 'vue';
import App from './App.vue';
import { initTheme } from './theme';
import './style.css';

initTheme();

createApp(App).mount('#app');
