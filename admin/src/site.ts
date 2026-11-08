import { ref } from 'vue';

// Every view but the server settings belongs to this site, chosen after signing in
const SITE_KEY = 'amw-admin-site';

function read(): string {
  try {
    return localStorage.getItem(SITE_KEY) ?? '';
  } catch {
    return '';
  }
}

/** The host of the active site, remembered by the browser; empty until one is chosen. */
export const activeSite = ref(read());

export function setActiveSite(host: string): void {
  activeSite.value = host;
  try {
    if (host) localStorage.setItem(SITE_KEY, host);
    else localStorage.removeItem(SITE_KEY);
  } catch {
    // Private browsing: the choice lasts until the page is reloaded
  }
}
