<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { LogOut, Moon, Sun } from '@lucide/vue';
import { VIEWS, type ViewId } from '../navigation';
import { theme, toggleTheme } from '../theme';

const props = defineProps<{ active: ViewId }>();
const emit = defineEmits<{ select: [ViewId]; logout: [] }>();

// Roving tabindex: only the focused tab is in the tab order, arrows move between
// tabs. Activation is manual (Enter, Space, click) so that browsing with the
// keyboard never starts the slow Insights request by accident.
const focused = ref<ViewId>(props.active);
const tabs = ref<HTMLButtonElement[]>([]);
// The view also changes with the back button
watch(() => props.active, id => { focused.value = id; });

function focusTab(index: number): void {
  const count = VIEWS.length;
  const view = VIEWS[(index + count) % count];
  focused.value = view.id;
  void nextTick(() => tabs.value.find(tab => tab.dataset.view === view.id)?.focus());
}

function onKeydown(event: KeyboardEvent): void {
  const index = VIEWS.findIndex(view => view.id === focused.value);
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
      focusTab(VIEWS.length - 1);
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
    <div class="activitybar-views" role="tablist" aria-orientation="vertical" aria-label="Views" @keydown="onKeydown" @focusout="onFocusout">
      <button
        v-for="view in VIEWS"
        :id="`tab-${view.id}`"
        :key="view.id"
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
