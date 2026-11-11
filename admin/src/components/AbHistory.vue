<script setup lang="ts">
import { computed } from 'vue';
import type { AbHistoryEntry } from '../api';
import { compareVariants } from '../effects';

/**
 * The A/B tests that ended on the active site, newest first, with the winner of each when its
 * results named one: it can be applied in one click once no test runs.
 */
const props = defineProps<{
  tests: AbHistoryEntry[];
  /** The value each kind has on the site now: a winner already in place needs no button. */
  current: Record<AbHistoryEntry['kind'], string>;
  /** Applying is locked while a test runs or without a store. */
  locked: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{ apply: [kind: AbHistoryEntry['kind'], value: string] }>();

const KINDS: Record<AbHistoryEntry['kind'], string> = { theme: 'Theme', effect: 'Effect', label: 'Button label' };
const REASONS: Record<AbHistoryEntry['reason'], string> = {
  kept: 'Kept',
  stopped: 'Stopped, back to',
  expired: 'Planned end, back to'
};

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '?');

/** The best variant shown better than the control by the same rules as a running test. */
function winnerOf(test: AbHistoryEntry): string | null {
  if (!test.results) return null;
  const rows = test.results.map(row => ({ ...row, ctr: row.views > 0 ? row.clicks / row.views : 0 }));
  const better = compareVariants(rows, test.control)
    .filter(row => row.verdict === 'better')
    .sort((a, b) => (b.uplift ?? 0) - (a.uplift ?? 0));
  return better[0]?.name ?? null;
}

const rows = computed(() => props.tests.map(test => ({ test, winner: winnerOf(test) })));
</script>

<template>
  <section class="card ab-history">
    <h2>Past tests</h2>
    <p v-if="tests.length === 0" class="muted">No test has ended on this site yet.</p>
    <div v-else class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">Dates</th>
            <th scope="col">Variants</th>
            <th scope="col">End</th>
            <th scope="col">Winner</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="({ test, winner }, index) in rows" :key="`${test.kind}-${test.endedAt}-${index}`">
            <td>{{ KINDS[test.kind] }}</td>
            <td>{{ day(test.startedAt) }} – {{ day(test.endedAt) }}</td>
            <td>
              <span v-for="(variant, i) in test.variants" :key="variant"><code>{{ variant }}</code><span v-if="i < test.variants.length - 1">, </span></span>
            </td>
            <td>{{ REASONS[test.reason] }} <code>{{ test.kept }}</code></td>
            <td>
              <template v-if="winner">
                <code>{{ winner }}</code>{{ ' ' }}
                <button
                  v-if="winner !== current[test.kind]"
                  type="button"
                  class="secondary small"
                  :disabled="locked || busy"
                  :aria-label="`Apply ${winner} to the site`"
                  @click="emit('apply', test.kind, winner)"
                >Apply</button>
                <span v-else class="muted"> (in place)</span>
              </template>
              <span v-else-if="test.results" class="muted">No clear winner</span>
              <span v-else class="muted">No results</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
