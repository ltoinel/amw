import { ref, watch } from 'vue';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'amw-admin-theme';

// Storage may be unavailable (private mode, blocked site data): the theme then
// simply follows the system and is not remembered
function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
}

export const theme = ref<Theme>('dark');

let initialized = false;

/**
 * Applies the stored theme, or the system one when the admin never chose,
 * and keeps following the system until a manual choice is made.
 */
export function initTheme(): void {
  const query = darkQuery();
  theme.value = storedTheme() ?? (query?.matches === false ? 'light' : 'dark');
  if (initialized) return;
  initialized = true;
  // Synchronous so that the charts, which read the CSS variables, re-render
  // with the new attribute already in place
  watch(theme, value => { document.documentElement.dataset.theme = value; }, { immediate: true, flush: 'sync' });
  query?.addEventListener('change', event => {
    if (storedTheme() === null) theme.value = event.matches ? 'dark' : 'light';
  });
}

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(STORAGE_KEY, theme.value);
  } catch {
    // Not persisted, still applied for this page
  }
}

/** Reads a color token of the current theme, for canvas rendering (Chart.js). */
export function themeColor(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
