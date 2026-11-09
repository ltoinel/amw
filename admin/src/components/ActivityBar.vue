<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { LogOut, Moon, Sun } from '@lucide/vue';
import { MENU_VIEWS, SERVER_VIEWS, type ViewId } from '../navigation';
import { theme, toggleTheme } from '../theme';
import AmwLogo from './AmwLogo.vue';

const props = defineProps<{ active: ViewId }>();
const emit = defineEmits<{ select: [ViewId]; logout: [] }>();

// Roving tabindex: only the focused tab is in the tab order, arrows move between
// tabs. Activation is manual (Enter, Space, click) so that browsing with the
// keyboard never starts the slow Insights request by accident.
const focused = ref<ViewId>(props.active);
const tabs = ref<HTMLButtonElement[]>([]);
// The view also changes with the back button; on phones the bar scrolls, so the active tab is
// brought into view
watch(() => props.active, id => {
  focused.value = id;
  void nextTick(() => tabs.value.find(tab => tab.dataset.view === id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }));
}, { immediate: true });

function focusTab(index: number): void {
  const count = MENU_VIEWS.length;
  const view = MENU_VIEWS[(index + count) % count];
  focused.value = view.id;
  void nextTick(() => tabs.value.find(tab => tab.dataset.view === view.id)?.focus());
}

function onKeydown(event: KeyboardEvent): void {
  const index = MENU_VIEWS.findIndex(view => view.id === focused.value);
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      focusTab(index + 1);
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
      focusTab(index - 1);
      break;
    case 'Home':
      focusTab(0);
      break;
    case 'End':
      focusTab(MENU_VIEWS.length - 1);
      break;
    default:
      return;
  }
  event.preventDefault();
}

// Tabbing back into the bar lands on the selected view, as in the ARIA tabs pattern
function onFocusout(event: FocusEvent): void {
  const list = event.currentTarget as HTMLElement;
  if (!list.contains(event.relatedTarget as Node | null)) focused.value = props.active;
}

function select(id: ViewId): void {
  focused.value = id;
  emit('select', id);
}
</script>

<template>
  <nav class="activitybar" aria-label="Views">
    <!-- The home of the portal, as the logo of a site usually is -->
    <a class="activitybar-logo" href="#/overview" aria-label="Overview"><AmwLogo /></a>
    <div class="activitybar-views" role="tablist" aria-orientation="vertical" aria-label="Views" @keydown="onKeydown" @focusout="onFocusout">
      <template v-for="(view, index) in MENU_VIEWS" :key="view.id">
      <!-- The views of every site sit at the bottom, apart from those of the active site -->
      <div v-if="SERVER_VIEWS.includes(view.id) && !SERVER_VIEWS.includes(MENU_VIEWS[index - 1]?.id)" class="activity-spacer" aria-hidden="true" />
      <button
        :id="`tab-${view.id}`"
        ref="tabs"
        type="button"
        role="tab"
        class="activity"
        :class="{ active: active === view.id }"
        :data-view="view.id"
        :aria-selected="active === view.id"
        aria-controls="view-panel"
        :aria-label="view.label"
        :tabindex="focused === view.id ? 0 : -1"
        @click="select(view.id)"
        @focus="focused = view.id"
      >
        <component :is="view.icon" class="icon" aria-hidden="true" />
        <span class="activity-label" aria-hidden="true">{{ view.label }}</span>
        <span class="tooltip" aria-hidden="true">{{ view.label }}</span>
      </button>
      </template>
    </div>
    <div class="activitybar-actions">
      <button
        type="button"
        class="activity theme-toggle"
        :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
        @click="toggleTheme"
      >
        <Sun v-if="theme === 'dark'" class="icon" aria-hidden="true" />
        <Moon v-else class="icon" aria-hidden="true" />
        <span class="tooltip" aria-hidden="true">{{ theme === 'dark' ? 'Light theme' : 'Dark theme' }}</span>
      </button>
      <button type="button" class="activity sign-out" aria-label="Sign out" @click="emit('logout')">
        <LogOut class="icon" aria-hidden="true" />
        <span class="tooltip" aria-hidden="true">Sign out</span>
      </button>
    </div>
  </nav>
</template>
