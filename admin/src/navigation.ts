import { onMounted, onUnmounted, ref, type Component } from 'vue';
import { FileText, LayoutDashboard, Package, PackageX, Sparkles } from '@lucide/vue';

export type ViewId = 'overview' | 'products' | 'pages' | 'notfound' | 'insights';

export interface ViewDefinition {
  id: ViewId;
  label: string;
  title: string;
  icon: Component;
}

export const VIEWS: ViewDefinition[] = [
  { id: 'overview', label: 'Overview', title: 'Overview', icon: LayoutDashboard },
  { id: 'products', label: 'Products', title: 'Most displayed products', icon: Package },
  { id: 'pages', label: 'Pages', title: 'Best performing pages', icon: FileText },
  { id: 'notfound', label: 'To replace', title: 'Products to replace', icon: PackageX },
  { id: 'insights', label: 'Insights', title: 'Insights (AI)', icon: Sparkles }
];

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
