<script setup lang="ts">
import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { CircleAlert, Info, RefreshCw, Sparkles } from '@lucide/vue';
import { generateInsights, getInsights, UnauthorizedError, type Insights } from '../api';

const props = defineProps<{ days: number }>();
const emit = defineEmits<{ logout: [] }>();

const DOCS_URL = 'https://ltoinel.github.io/amw/user-guide/admin-portal/#insights';

const insights = ref<Insights | null>(null);
// Reading the last analysis (fast) and generating one (slow, billed) are told apart
const loading = ref(false);
const generating = ref(false);
const error = ref('');
const elapsed = ref(0);
// Period of the result shown, or of the request in flight
let shownDays = 0;
let sequence = 0;
let timer: ReturnType<typeof setInterval> | undefined;
// Kept alive by the dashboard: a hidden view must not start a request
let active = true;

const result = computed(() => (insights.value?.available && !insights.value.missing ? insights.value : null));
const missing = computed(() => insights.value?.available === true && insights.value.missing === true);
const generatedAt = computed(() => (result.value ? new Date(result.value.generatedAt).toLocaleString() : ''));
const age = computed(() => {
  if (!result.value) return '';
  const hours = Math.floor((Date.now() - Date.parse(result.value.generatedAt)) / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
});

function stopTimer(): void {
  clearInterval(timer);
  timer = undefined;
}

async function run(request: () => Promise<Insights>, slow: boolean): Promise<void> {
  const id = ++sequence;
  shownDays = props.days;
  error.value = '';
  loading.value = !slow;
  generating.value = slow;
  stopTimer();
  if (slow) {
    elapsed.value = 0;
    timer = setInterval(() => { elapsed.value += 1; }, 1000);
  }
  try {
    const response = await request();
    if (id !== sequence) return;
    insights.value = response;
  } catch (e) {
    if (id !== sequence) return;
    if (e instanceof UnauthorizedError) {
      emit('logout');
      return;
    }
    // Read again the next time the view is opened
    shownDays = 0;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    if (id === sequence) {
      loading.value = false;
      generating.value = false;
      stopTimer();
    }
  }
}

const generate = () => run(() => generateInsights(props.days), true);

// Opening the view only shows the last analysis of the period: asking the model
// is always the admin's decision
function showLast(): void {
  if (shownDays === props.days && (loading.value || generating.value || insights.value)) return;
  insights.value = null;
  void run(() => getInsights(props.days), false);
}

onMounted(showLast);
onActivated(() => { active = true; showLast(); });
onDeactivated(() => { active = false; });
onUnmounted(stopTimer);
watch(() => props.days, () => { if (active) showLast(); });
</script>

<template>
  <div class="insights">
    <p v-if="loading" class="muted" role="status">Loading the last analysis…</p>

    <div v-else-if="generating" class="card insights-progress" role="status">
      <Sparkles class="icon pulse" aria-hidden="true" />
      <div>
        <p class="insights-progress-title">Analysing the last {{ days }} days…</p>
        <p class="muted">An AI model is reading your statistics, this usually takes 10 to 60 seconds.</p>
        <div class="progress" aria-hidden="true"><span></span></div>
      </div>
      <span class="muted elapsed" aria-hidden="true">{{ elapsed }} s</span>
    </div>

    <div v-else-if="error" class="card insights-error" role="alert">
      <CircleAlert class="icon" aria-hidden="true" />
      <div>
        <p>{{ error }}</p>
        <button type="button" class="secondary" @click="insights?.available ? generate() : showLast()">Try again</button>
      </div>
    </div>

    <section v-else-if="insights && !insights.available" class="card notice">
      <h2><Info class="icon" aria-hidden="true" /> Insights are not available</h2>
      <p>{{ insights.reason }}</p>
      <p class="muted">
        Enable <code>Admin.insights</code> and set the <code>ANTHROPIC_API_KEY</code> environment variable, then
        restart the server. See the
        <a :href="DOCS_URL" target="_blank" rel="noopener noreferrer">documentation</a>.
      </p>
    </section>

    <template v-else-if="result">
      <div class="insights-meta">
        <span class="badge"><Sparkles class="icon" aria-hidden="true" /> AI-generated</span>
        <span class="muted">
          {{ result.days }} days · generated <time :datetime="result.generatedAt" :title="generatedAt">{{ age }}</time> ·
          {{ result.model }}
        </span>
        <button type="button" class="secondary" @click="generate()">
          <RefreshCw class="icon" aria-hidden="true" /> Regenerate
        </button>
      </div>

      <section class="card">
        <h2>Summary</h2>
        <p class="model-text">{{ result.summary }}</p>
      </section>

      <section class="card">
        <h2>Recommendations</h2>
        <p v-if="!result.recommendations?.length" class="muted">No recommendation for this period.</p>
        <ol v-else class="recommendations">
          <li v-for="(recommendation, index) in result.recommendations" :key="index">
            <strong class="model-text">{{ recommendation.title }}</strong>
            <p class="model-text">{{ recommendation.detail }}</p>
          </li>
        </ol>
      </section>

      <p class="muted disclaimer">
        Generated by an AI model from your usage statistics: it can be wrong, check before acting on it.
      </p>
    </template>

    <div v-else-if="missing" class="card">
      <p>No analysis of the last {{ days }} days yet.</p>
      <p class="muted">
        Insights summarise the period and suggest what to improve. An AI model reads your
        statistics (10 to 60 seconds); each analysis is billed to your Anthropic account.
      </p>
      <button type="button" @click="generate()"><Sparkles class="icon" aria-hidden="true" /> Generate</button>
    </div>
  </div>
</template>
