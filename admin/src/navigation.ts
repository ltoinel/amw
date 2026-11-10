import { onMounted, onUnmounted, ref, type Component } from 'vue';
import { BadgePercent, CircleDollarSign, CircleGauge, FileText, Globe, ListOrdered, LayoutDashboard, ListPlus, Package, PackageX, Palette, Settings, Sparkles, Tags } from '@lucide/vue';

export type ViewId = 'overview' | 'products' | 'pages' | 'notfound' | 'keywords' | 'insights' | 'abtests' | 'stuffing' | 'custom' | 'deals' | 'sites' | 'quota' | 'aicost' | 'settings';

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
  { id: 'keywords', label: 'AI Recommendation', title: 'AI Recommendation', icon: Tags },
  // #/abtests since the view held the A/B tests only: kept so that bookmarks still open it
  { id: 'abtests', label: 'Design', title: 'Design', icon: Palette },
  { id: 'stuffing', label: 'Stuffing', title: 'Stuffing', icon: ListPlus },
  { id: 'custom', label: 'Custom products', title: 'Custom products', icon: ListOrdered },
  { id: 'deals', label: 'Best deals', title: 'Best deals', icon: BadgePercent },
  // #/insights since before the costs moved here: kept so that bookmarks still open it
  { id: 'insights', label: 'AI', title: 'AI', icon: Sparkles },
  // Opened with the gear next to the site switcher: the sites are the context of every other view
  { id: 'sites', label: 'Sites', title: 'Sites', icon: Globe, hidden: true },
  // Shared by every site: the quota belongs to the Associates account
  { id: 'quota', label: 'Amazon quota', title: 'Amazon quota', icon: CircleGauge },
  // Shared by every site: the Claude calls are billed to one account
  { id: 'aicost', label: 'AI cost', title: 'Estimated AI cost', icon: CircleDollarSign },
  { id: 'settings', label: 'Server settings', title: 'Server settings', icon: Settings }
];

/** The views of the activity bar. */
export const MENU_VIEWS = VIEWS.filter(view => !view.hidden);

/** The views that do not depend on the active site. */
export const SERVER_VIEWS: ViewId[] = ['settings', 'sites', 'quota', 'aicost'];


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
