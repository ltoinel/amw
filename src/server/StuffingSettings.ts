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
  CONTAINER_ID, EFFECT_MODES, MAX_DEAL_SAVING, MIN_DEAL_SAVING, SEARCH_INDEX, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, MAX_STUFFING_SITES, MAX_WORDS_PER_CARD, PARTNER_TAG, SITE_HOST,
  BUTTON_LABELS, STUFFING_MODES, STUFFING_SOURCES, THEME_TEST_MODES, WIDGET_EFFECTS, WIDGET_THEMES,
  type ButtonLabelConfig, type EffectConfig, type PartnerTagsConfig, type StuffingConfig, type ThemeTestConfig
} from "./Settings";

const stuffingSchema = z.strictObject({
  // Values stored before the switch existed added their cards
  enabled: z.boolean().default(true),
  count: z.number().int().min(0).max(MAX_STUFFED_CARDS),
  containerId: z.string().regex(CONTAINER_ID),
  // Values stored before the modes existed were recommendations
  mode: z.enum(STUFFING_MODES).default('recommendation'),
  // Values stored before the list existed have none
  products: z.array(z.string().regex(ASIN_PATTERN)).max(MAX_STUFFING_PRODUCTS).default([]),
  // Values stored before the ratio existed had none
  wordsPerCard: z.number().int().min(0).max(MAX_WORDS_PER_CARD).default(0),
  // Hosts only: the keys reach widget.js, which compares them with location.host
  sites: z.record(z.string().regex(SITE_HOST), z.number().int().min(0).max(MAX_STUFFED_CARDS))
    .refine(sites => Object.keys(sites).length <= MAX_STUFFING_SITES, 'too many sites')
    .default({}),
  // Values stored before deals mode existed have no search
  deals: z.strictObject({
    // Sent to Amazon as is: printable text only
    keywords: z.string().trim().max(100).regex(/^[^\p{Cc}]*$/u),
    searchIndex: z.string().regex(SEARCH_INDEX),
    minSavingPercent: z.number().int().min(MIN_DEAL_SAVING).max(MAX_DEAL_SAVING),
  }).default({ keywords: '', searchIndex: 'All', minSavingPercent: 20 }),
  // Values stored before mix mode existed have no weights
  weights: z.strictObject(Object.fromEntries(STUFFING_SOURCES.map(source => [source, z.number().int().min(0).max(100)])) as Record<typeof STUFFING_SOURCES[number], z.ZodNumber>)
    .default({ recommendation: 0, popular: 0, manual: 0, deals: 0 }),
})
  .refine(value => value.mode !== 'deals' || value.deals.keywords !== '', { message: 'deals mode needs keywords', path: ['deals', 'keywords'] })
  // Shares of the cards, as the portal shows them
  .refine(value => value.mode !== 'mix' || Object.values(value.weights).reduce((sum, weight) => sum + weight, 0) === 100, { message: 'the shares of a mix make 100', path: ['weights'] })
  .refine(value => value.mode !== 'mix' || value.weights.deals === 0 || value.deals.keywords !== '', { message: 'deals in a mix need keywords', path: ['deals', 'keywords'] });

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
}).refine(value => value.mode !== 'compare' || value.effects.length >= 2, 'compare needs two effects');

const themeTestSchema = z.strictObject({
  mode: z.enum(THEME_TEST_MODES),
  themes: variants(WIDGET_THEMES),
  theme: z.enum(WIDGET_THEMES).optional(),
  startedAt: z.iso.datetime().optional(),
}).refine(value => value.mode !== 'compare' || value.themes.length >= 2, 'compare needs two themes');

const THEME_TEST_OFF: ThemeTestConfig = { mode: 'off', themes: [] };

const buttonLabelSchema = z.strictObject({
  label: z.enum(BUTTON_LABELS),
  mode: z.enum(THEME_TEST_MODES),
  labels: variants(BUTTON_LABELS),
  startedAt: z.iso.datetime().optional(),
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

class EffectSettings extends RuntimeSetting<EffectConfig> {
  constructor(defaults: EffectConfig, store?: SettingStore, now?: () => number) {
    super('amw:settings:effect', effectSchema, defaults, store, now);
  }
}

class ThemeTestSettings extends RuntimeSetting<ThemeTestConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:theme-test', themeTestSchema, THEME_TEST_OFF, store, now);
  }
}

class ButtonLabelSettings extends RuntimeSetting<ButtonLabelConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:button-label', buttonLabelSchema, BUTTON_LABEL_DEFAULT, store, now);
  }
}

class PartnerTagSettings extends RuntimeSetting<PartnerTagsConfig> {
  constructor(store?: SettingStore, now?: () => number) {
    super('amw:settings:partner-tags', partnerTagsSchema, { sites: {} }, store, now);
  }
}

export { ButtonLabelSettings, EffectSettings, PartnerTagSettings, StuffingSettings, ThemeTestSettings };
