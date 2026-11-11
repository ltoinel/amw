/**
 * Where Stuffing adds cards to an article, which effect makes the cards appear, which themes are
 * compared and the tracking ID of each site: settings that can change while the server runs.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { z } from "zod";
import { RuntimeSetting } from "./RuntimeSetting";
import type { SettingStore } from "./SettingStore";
import { ASIN_PATTERN } from "./Schemas";
import {
  BANNER_ID, BANNER_PREFIX, CONTAINER_ID, EFFECT_MODES, MAX_DEAL_SAVING, MIN_DEAL_SAVING, SEARCH_INDEX, MAX_DEAL_SEARCHES, MAX_DEAL_PRODUCTS, dealSearchesOf, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, MAX_STUFFING_SITES, MAX_WORDS_PER_CARD, PARTNER_TAG, SITE_HOST,
  BUTTON_LABELS, STUFFING_MODES, STUFFING_SOURCES, THEME_TEST_MODES, WIDGET_EFFECTS, WIDGET_THEMES,
  type ButtonLabelConfig, type EffectConfig, type PartnerTagsConfig, type StuffingConfig, type ThemeTestConfig
} from "./Settings";

const dealsSchema = z.strictObject({
  // Sent to Amazon as is: printable text only
  keywords: z.string().trim().max(100).regex(/^[^\p{Cc}]*$/u),
  searchIndex: z.string().regex(SEARCH_INDEX),
  minSavingPercent: z.number().int().min(MIN_DEAL_SAVING).max(MAX_DEAL_SAVING),
});

/** A search of the Best deals view: keywords are needed, the API finding nothing without them. */
const dealSearchSchema = dealsSchema.extend({
  keywords: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}]*$/u),
  maxProducts: z.number().int().min(1).max(MAX_DEAL_PRODUCTS),
});

/** A link the widget opens and an image it shows: web addresses only, the image over https. */
const webUrl = (protocols: string[]) => z.string().max(1000).refine(value => {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, 'not a web address');
// Shown as text by the widget: printable, without markup characters, which it would not need
const plainText = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}<>]*$/u);

const bannerSchema = z.strictObject({
  id: z.string().regex(BANNER_ID),
  title: plainText(150),
  image: webUrl(['https:']),
  url: webUrl(['https:', 'http:']),
  label: plainText(40).optional(),
});

const stuffingSchema = z.strictObject({
  // Values stored before the switch existed added their cards
  enabled: z.boolean().default(true),
  count: z.number().int().min(0).max(MAX_STUFFED_CARDS),
  containerId: z.string().regex(CONTAINER_ID),
  // Values stored before the modes existed were recommendations
  mode: z.enum(STUFFING_MODES).default('recommendation'),
  // Values stored before the list existed have none
  products: z.array(z.string().refine(item => ASIN_PATTERN.test(item) || (item.startsWith(BANNER_PREFIX) && BANNER_ID.test(item.slice(BANNER_PREFIX.length))), 'an ASIN or banner:<id>'))
    .max(MAX_STUFFING_PRODUCTS).default([]),
  // Values stored before the banners existed have none
  banners: z.array(bannerSchema).max(MAX_STUFFING_PRODUCTS)
    .refine(list => new Set(list.map(banner => banner.id)).size === list.length, 'repeated banner id').default([]),
  // Values stored before the ratio existed had none
  wordsPerCard: z.number().int().min(0).max(MAX_WORDS_PER_CARD).default(0),
  // Hosts only: the keys reach widget.js, which compares them with location.host
  sites: z.record(z.string().regex(SITE_HOST), z.number().int().min(0).max(MAX_STUFFED_CARDS))
    .refine(sites => Object.keys(sites).length <= MAX_STUFFING_SITES, 'too many sites')
    .default({}),
  // Values stored before deals mode existed have no search
  deals: dealsSchema.default({ keywords: '', searchIndex: 'All', minSavingPercent: 20 }),
  // Values stored before the Best deals view have none: their single search applies
  dealSearches: z.array(dealSearchSchema).max(MAX_DEAL_SEARCHES).default([]),
  // Values stored before mix mode existed have no weights
  weights: z.strictObject(Object.fromEntries(STUFFING_SOURCES.map(source => [source, z.number().int().min(0).max(100)])) as Record<typeof STUFFING_SOURCES[number], z.ZodNumber>)
    .default({ recommendation: 0, popular: 0, manual: 0, deals: 0 }),
})
  // A banner of the list must be one of the site
  .refine(value => value.products.every(item => !item.startsWith(BANNER_PREFIX) || value.banners.some(banner => `${BANNER_PREFIX}${banner.id}` === item)), { message: 'unknown banner', path: ['products'] })
  .refine(value => value.mode !== 'deals' || dealSearchesOf(value).length > 0, { message: 'deals mode needs a search', path: ['dealSearches'] })
  // Shares of the cards, as the portal shows them
  .refine(value => value.mode !== 'mix' || Object.values(value.weights).reduce((sum, weight) => sum + weight, 0) === 100, { message: 'the shares of a mix make 100', path: ['weights'] })
  .refine(value => value.mode !== 'mix' || value.weights.deals === 0 || dealSearchesOf(value).length > 0, { message: 'deals in a mix need a search', path: ['dealSearches'] });

/** A list of known names without repeats: a repeat would weigh its variant twice in the draw. */
function variants<T extends string>(names: readonly [T, ...T[]]) {
  return z.array(z.enum(names)).refine(list => new Set(list).size === list.length, 'repeated name');
}

// A comparison needs two variants at least
const effectSchema = z.strictObject({
  mode: z.enum(EFFECT_MODES),
  // Values stored before the list existed compared all the effects
  effects: variants(WIDGET_EFFECTS).default([...WIDGET_EFFECTS]),
  // Set by the server when a test starts
  startedAt: z.iso.datetime().optional(),
  // Set by the server from the planned duration of the test
  endsAt: z.iso.datetime().optional(),
}).refine(value => value.mode !== 'compare' || value.effects.length >= 2, 'compare needs two effects');

const themeTestSchema = z.strictObject({
  mode: z.enum(THEME_TEST_MODES),
  themes: variants(WIDGET_THEMES),
  theme: z.enum(WIDGET_THEMES).optional(),
  startedAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
}).refine(value => value.mode !== 'compare' || value.themes.length >= 2, 'compare needs two themes');

const THEME_TEST_OFF: ThemeTestConfig = { mode: 'off', themes: [] };

const buttonLabelSchema = z.strictObject({
  label: z.enum(BUTTON_LABELS),
  mode: z.enum(THEME_TEST_MODES),
  labels: variants(BUTTON_LABELS),
  startedAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
}).refine(value => value.mode !== 'compare' || value.labels.length >= 2, 'compare needs two labels');

// "See the offer on Amazon": low-commitment calls to action naming Amazon draw the most clicks
const BUTTON_LABEL_DEFAULT: ButtonLabelConfig = { label: 'offer', mode: 'off', labels: [] };

// Hosts and tracking IDs only: both are prepended to widget.js
const partnerTagsSchema = z.strictObject({
  sites: z.record(z.string().regex(SITE_HOST), z.string().regex(PARTNER_TAG))
    .refine(sites => Object.keys(sites).length <= MAX_STUFFING_SITES, 'too many sites'),
});

class StuffingSettings extends RuntimeSetting<StuffingConfig> {
  constructor(defaults: StuffingConfig, store?: SettingStore, now?: () => number) {
    super('amw:settings:stuffing', stuffingSchema, defaults, store, now);
  }
}

/** Whether a test with a planned duration is over at `now`. */
function ended(value: { mode: string; endsAt?: string }, now: number): boolean {
  return value.mode === 'compare' && value.endsAt !== undefined && Date.parse(value.endsAt) <= now;
}

/**
 * An A/B test past its planned duration goes back to the control group, the value it would keep
 * if stopped: ending on time avoids a winner chosen by stopping on a lucky day.
 */
const expireEffect = (value: EffectConfig, now: number): EffectConfig =>
  (ended(value, now) ? { mode: 'none', effects: value.effects } : value);
const expireThemeTest = (value: ThemeTestConfig, now: number): ThemeTestConfig =>
  (ended(value, now) ? { mode: 'off', themes: [], ...(value.theme ? { theme: value.theme } : {}) } : value);
const expireButtonLabel = (value: ButtonLabelConfig, now: number): ButtonLabelConfig =>
  (ended(value, now) ? { label: value.label, mode: 'off', labels: [] } : value);

class EffectSettings extends RuntimeSetting<EffectConfig> {
  constructor(defaults: EffectConfig, store?: SettingStore, now?: () => number) {
    super('amw:settings:effect', effectSchema, defaults, store, now, expireEffect);
  }
}

class ThemeTestSettings extends RuntimeSetting<ThemeTestConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:theme-test', themeTestSchema, THEME_TEST_OFF, store, now, expireThemeTest);
  }
}

class ButtonLabelSettings extends RuntimeSetting<ButtonLabelConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:button-label', buttonLabelSchema, BUTTON_LABEL_DEFAULT, store, now, expireButtonLabel);
  }
}

// The last tests of a site, newest first: enough to look back over a year of monthly tests
const AB_HISTORY_SIZE = 50;

const variantResultSchema = z.strictObject({
  name: z.string().max(32),
  views: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
});

const abHistorySchema = z.strictObject({
  tests: z.array(z.strictObject({
    kind: z.enum(['theme', 'effect', 'label']),
    variants: z.array(z.string().max(32)).max(20),
    // The value of the site before the test, against which the others were measured
    control: z.string().max(32),
    startedAt: z.iso.datetime().optional(),
    endedAt: z.iso.datetime(),
    // The planned end, for a test given a duration
    endsAt: z.iso.datetime().optional(),
    // kept: a variant chosen in the results; stopped: back to the control; expired: its duration ran out
    reason: z.enum(['kept', 'stopped', 'expired']),
    // The value the site kept when the test ended
    kept: z.string().max(32),
    // The views and clicks of each variant over the test, when the statistics could be read
    results: z.array(variantResultSchema).max(20).optional(),
  })).max(AB_HISTORY_SIZE),
});

type AbHistory = z.infer<typeof abHistorySchema>;
type AbHistoryEntry = AbHistory['tests'][number];

/** The A/B tests that ended, per site like the tests themselves. */
class AbHistorySettings extends RuntimeSetting<AbHistory> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:ab-history', abHistorySchema, { tests: [] }, store, now);
  }
}

class PartnerTagSettings extends RuntimeSetting<PartnerTagsConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:partner-tags', partnerTagsSchema, { sites: {} }, store, now);
  }
}

export { AB_HISTORY_SIZE, AbHistorySettings, ButtonLabelSettings, EffectSettings, PartnerTagSettings, StuffingSettings, ThemeTestSettings };
export type { AbHistoryEntry };

export { dealSearchSchema };
