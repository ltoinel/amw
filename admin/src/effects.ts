import type { EffectStats } from './api';

// Below these, a difference is mostly noise, whatever the test below says
const MIN_VIEWS = 500;
const MIN_CLICKS = 10;
// Two-sided z for a 5 % risk of a false winner over all the comparisons with the control group
// (Bonferroni): each variant compared is one more chance of a lucky winner
const SIGNIFICANT_Z = [1.96, 1.96, 2.24, 2.39, 2.5, 2.58, 2.64, 2.69, 2.73, 2.77];

export type Verdict = 'control' | 'more-data' | 'better' | 'worse' | 'no-difference';

/** One group of an A/B test: an effect or a theme. */
export interface VariantStats {
  name: string;
  views: number;
  clicks: number;
  ctr: number;
}

export interface VariantComparison extends VariantStats {
  /** Relative to the control group: 0.1 for 10 % more clicks per view. Null without a control. */
  uplift: number | null;
  verdict: Verdict;
}

export interface EffectComparison extends EffectStats {
  uplift: number | null;
  verdict: Verdict;
}

/** Two-proportion z-test. An approximation: cards seen in one session are not fully independent. */
function zScore(a: VariantStats, b: VariantStats): number {
  const pooled = (a.clicks + b.clicks) / (a.views + b.views);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / a.views + 1 / b.views));
  return error > 0 ? (a.ctr - b.ctr) / error : 0;
}

/** @param control The name of the control group; without its row, nothing can be called a winner. */
export function compareVariants(rows: VariantStats[], control: string): VariantComparison[] {
  const reference = rows.find(row => row.name === control);
  const threshold = SIGNIFICANT_Z[Math.min(Math.max(rows.length - 1, 1), SIGNIFICANT_Z.length - 1)];
  return rows.map(row => {
    if (row.name === control) {
      return { ...row, uplift: null, verdict: 'control' };
    }
    const uplift = reference && reference.ctr > 0 ? row.ctr / reference.ctr - 1 : null;
    if (!reference || [row, reference].some(side => side.views < MIN_VIEWS || side.clicks < MIN_CLICKS)) {
      return { ...row, uplift, verdict: 'more-data' };
    }
    const z = zScore(row, reference);
    return { ...row, uplift, verdict: z >= threshold ? 'better' : z <= -threshold ? 'worse' : 'no-difference' };
  });
}

/** "none", no effect at all, is the control group of the effects. */
export function compareEffects(rows: EffectStats[]): EffectComparison[] {
  return compareVariants(rows.map(({ effect, ...figures }) => ({ name: effect, ...figures })), 'none')
    .map(({ name, ...rest }) => ({ effect: name, ...rest }));
}
