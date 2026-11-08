import { onMounted, onUnmounted, ref, type Component } from 'vue';
import { FileText, FlaskConical, Globe, LayoutDashboard, ListPlus, Package, PackageX, Settings, Sparkles, Tags } from '@lucide/vue';

export type ViewId = 'overview' | 'products' | 'pages' | 'notfound' | 'keywords' | 'insights' | 'abtests' | 'stuffing' | 'sites' | 'settings';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  title: string;
  icon: Component;
  /** Opened from elsewhere than the activity bar. */
  hidden?: boolean;
}

export const VIEWS: ViewDefinition[] = [
  { id: 'overview', label: 'Overview', title: 'Overview', icon: LayoutDashboard },
  { id: 'products', label: 'Products', title: 'Most displayed products', icon: Package },
  { id: 'pages', label: 'Pages', title: 'Best performing pages', icon: FileText },
  { id: 'notfound', label: 'To replace', title: 'Products to replace', icon: PackageX },
  { id: 'keywords', label: 'Keywords', title: 'Keywords per page', icon: Tags },
  // #/insights since before the costs moved here: kept so that bookmarks still open it
  { id: 'insights', label: 'AI', title: 'AI', icon: Sparkles },
  { id: 'abtests', label: 'A/B tests', title: 'A/B tests', icon: FlaskConical },
  { id: 'stuffing', label: 'Stuffing', title: 'Stuffing', icon: ListPlus },
  // Opened with the gear next to the site switcher: the sites are the context of every other view
  { id: 'sites', label: 'Sites', title: 'Sites', icon: Globe, hidden: true },
  { id: 'settings', label: 'Server settings', title: 'Server settings', icon: Settings }
];

/** The views of the activity bar. */
export const MENU_VIEWS = VIEWS.filter(view => !view.hidden);

/** The views that do not depend on the active site. */
export const SERVER_VIEWS: ViewId[] = ['settings', 'sites'];

function viewFromHash(): ViewId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.some(view => view.id === id) ? (id as ViewId) : 'overview';
}

/**
 * Current view, kept in the URL hash (#/pages…) so that reload and the back
 * button work without a router.
 */
export function useHashView() {
  const view = ref<ViewId>(viewFromHash());
  const onHashChange = () => { view.value = viewFromHash(); };

  onMounted(() => {
    window.addEventListener('hashchange', onHashChange);
    // Normalizes an empty or unknown hash without adding a history entry
    if (window.location.hash !== `#/${view.value}`) {
      history.replaceState(history.state, '', `#/${view.value}`);
    }
  });
  onUnmounted(() => window.removeEventListener('hashchange', onHashChange));

  function navigate(id: ViewId): void {
    if (id === view.value) return;
    view.value = id;
    window.location.hash = `/${id}`;
  }

  return { view, navigate };
}
