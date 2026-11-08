/**
 * Where Stuffing adds cards to an article, and which effect makes the cards appear: settings that
 * can change while the server runs.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import type { Redis } from "ioredis";
import { z } from "zod";
import { RuntimeSetting } from "./RuntimeSetting";
import { ASIN_PATTERN } from "./Schemas";
import { CONTAINER_ID, EFFECT_MODES, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, STUFFING_MODES, type EffectConfig, type StuffingConfig } from "./Settings";

const stuffingSchema = z.strictObject({
  count: z.number().int().min(0).max(MAX_STUFFED_CARDS),
  containerId: z.string().regex(CONTAINER_ID),
  // Values stored before the modes existed were recommendations
  mode: z.enum(STUFFING_MODES).default('recommendation'),
  // Values stored before the list existed have none
  products: z.array(z.string().regex(ASIN_PATTERN)).max(MAX_STUFFING_PRODUCTS).default([]),
});

const effectSchema = z.strictObject({ mode: z.enum(EFFECT_MODES) });

class StuffingSettings extends RuntimeSetting<StuffingConfig> {
  constructor(defaults: StuffingConfig, redis?: Redis, now?: () => number) {
    super('amw:settings:stuffing', stuffingSchema, defaults, redis, now);
  }
}

class EffectSettings extends RuntimeSetting<EffectConfig> {
  constructor(defaults: EffectConfig, redis?: Redis, now?: () => number) {
    super('amw:settings:effect', effectSchema, defaults, redis, now);
  }
}

export { EffectSettings, StuffingSettings };
