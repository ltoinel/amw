import type { EffectStats } from './api';

// Below these, a difference is mostly noise, whatever the test below says
const MIN_VIEWS = 500;
const MIN_CLICKS = 10;
// Four effects are compared with the control group: 2.5 instead of the usual 1.96 keeps the risk
// of a false winner near 5 % over the four comparisons (Bonferroni)
const SIGNIFICANT_Z = 2.5;

export type Verdict = 'control' | 'more-data' | 'better' | 'worse' | 'no-difference';

export interface EffectComparison extends EffectStats {
  /** Relative to the control group: 0.1 for 10 % more clicks per view. Null without a control. */
  uplift: number | null;
  verdict: Verdict;
}

/** Two-proportion z-test. An approximation: cards seen in one session are not fully independent. */
function zScore(a: EffectStats, b: EffectStats): number {
  const pooled = (a.clicks + b.clicks) / (a.views + b.views);
  const error = Math.sqrt(pooled * (1 - pooled) * (1 / a.views + 1 / b.views));
  return error > 0 ? (a.ctr - b.ctr) / error : 0;
}

export function compareEffects(rows: EffectStats[]): EffectComparison[] {
  const control = rows.find(row => row.effect === 'none');
  return rows.map(row => {
    if (row.effect === 'none') {
      return { ...row, uplift: null, verdict: 'control' };
    }
    const uplift = control && control.ctr > 0 ? row.ctr / control.ctr - 1 : null;
    if (!control || [row, control].some(side => side.views < MIN_VIEWS || side.clicks < MIN_CLICKS)) {
      return { ...row, uplift, verdict: 'more-data' };
    }
    const z = zScore(row, control);
    return { ...row, uplift, verdict: z >= SIGNIFICANT_Z ? 'better' : z <= -SIGNIFICANT_Z ? 'worse' : 'no-difference' };
  });
}
