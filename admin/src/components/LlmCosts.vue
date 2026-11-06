<script setup lang="ts">
import { computed } from 'vue';
import type { LlmUsage } from '../api';

const props = defineProps<{ usage: LlmUsage[] }>();

const FEATURES: Record<string, string> = { insights: 'Insights', recommendation: 'Recommendations' };

const total = computed(() => props.usage.reduce((sum, row) => sum + (row.estimatedCost ?? 0), 0));
const incomplete = computed(() => props.usage.some(row => row.estimatedCost === null));

const number = (value: number) => value.toLocaleString('en-US');

function dollars(value: number): string {
  // A tiny amount shown as $0.00 would read as free
  return value > 0 && value < 0.01 ? '< $0.01' : `$${value.toFixed(2)}`;
}
</script>

<template>
  <p class="muted">
    Estimate from the tokens of each call and list prices, over the period. The Anthropic invoice is the reference.
  </p>
  <div class="table-wrapper">
    <table>
      <thead>
        <tr>
          <th scope="col">Feature</th>
          <th scope="col">Model</th>
          <th scope="col">Calls</th>
          <th scope="col">Input tokens</th>
          <th scope="col">Output tokens</th>
          <th scope="col">Estimated cost</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in usage" :key="`${row.feature}|${row.model}`">
          <td>{{ FEATURES[row.feature] ?? row.feature }}</td>
          <td><code>{{ row.model }}</code></td>
          <td>{{ number(row.calls) }}</td>
          <td>{{ number(row.inputTokens) }}</td>
          <td>{{ number(row.outputTokens) }}</td>
          <td>{{ row.estimatedCost === null ? 'unknown' : dollars(row.estimatedCost) }}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" colspan="5">Total</th>
          <td><strong>{{ incomplete ? 'at least ' : '' }}{{ dollars(total) }}</strong></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
