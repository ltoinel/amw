/**
 * Administration API
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * JSON endpoints behind <path>/admin/api, protected by a password given through
 * the AMW_ADMIN_PASSWORD environment variable.
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import crypto from "crypto";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import express, { NextFunction, Request, Response, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { getLogger, Logger } from "../utils/logger";
import { Stats, noStore, PAGE_SORTS, type PageSort } from "./Stats";
import { describeSettings, EFFECT_MODES, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, THEME_TEST_MODES, type Settings, type SettingsSection } from "./Settings";
import type { Redis } from "ioredis";
import { Insights, InsightsError } from "./Insights";
import { InvalidKeywordsError, RecommendationEntry, RecommendationStore } from "./RecommendationStore";
import { PAGE_HASH_PATTERN } from "./Schemas";
import { AmazonCheck } from "./AmazonCheck";
import { EffectSettings, StuffingSettings, ThemeTestSettings } from "./StuffingSettings";
import { Paapi } from "./Paapi";

interface AdminOptions {
  password: string;
  // Tokens signed with a random secret are lost on restart, which only forces a new login
  secret?: string;
  tokenTtl?: number;
  loginRateLimit?: number;
  // Directory of the built portal (dist/admin); the API alone is served without it
  staticDir?: string;
  // AI insights, only when enabled: they send statistics to the Claude API
  insights?: Insights;
  // Stored product recommendations, only when enabled
  recommendations?: RecommendationStore;
  // Amazon host (e.g. www.amazon.fr) of the product pages linked from the portal
  marketplace?: string;
  // Running build, shown in the portal footer
  version?: BuildVersion;
  // Effective settings shown in the portal, secrets already reduced to whether they are set
  settings?: SettingsSection[];
  // The "Test the Amazon API" button of the portal
  amazonCheck?: AmazonCheck;
  // Cards added to articles by widget.js, editable in the portal
  stuffing?: StuffingSettings;
  // How the cards appear, editable in the portal
  effect?: EffectSettings;
  // The themes compared, editable in the portal
  themeTest?: ThemeTestSettings;
  // Server.theme: the control group of a theme A/B test
  defaultTheme?: string;
  recommendationEnabled?: boolean;
}

interface BuildVersion {
  release: string;
  // Set by the Docker build (AMW_REVISION, AMW_BUILD_DATE); null for other installs
  revision: string | null;
  buildDate: string | null;
}

/**
 * Administration API.
 */
class AdminApi {

  public static readonly MIN_PASSWORD_LENGTH: number = 12;
  private static readonly DEFAULT_TOKEN_TTL: number = 3600;
  private static readonly DEFAULT_LOGIN_RATE_LIMIT: number = 10;
  private static readonly DEFAULT_DAYS: number = 30;
  private static readonly DEFAULT_LIMIT: number = 50;
  private static readonly MAX_LIMIT: number = 500;
  // Lowercase, as URL.hostname normalises the stored page URLs
  private static readonly HOSTNAME: RegExp = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/;
  private static readonly KEY_LENGTH: number = 32;
  // Authenticated calls per minute and per IP: the portal makes 8 per refresh
  private static readonly API_RATE_LIMIT: number = 120;
  private static readonly scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
  private static readonly STATS_UNAVAILABLE: string = 'Statistics require Redis';
  private static readonly INSIGHTS_DISABLED: string = 'AI insights are disabled (Admin.insights)';
  private static readonly RECOMMENDATIONS_DISABLED: string = 'Automatic products are disabled (Recommendation.enabled)';
  private static readonly MARKETPLACE: RegExp = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
  // Product images come from Amazon; everything else from this server
  private static readonly CONTENT_SECURITY_POLICY: string = [
    "default-src 'self'",
    "img-src 'self' https: data:",
    // Chart.js sizes its canvas through inline style attributes
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

  private readonly log: Logger;
  private readonly stats: Stats;
  private readonly passwordSalt: Buffer;
  private readonly passwordKey: Buffer;
  private readonly secret: Buffer;
  private readonly tokenTtl: number;
  private readonly loginRateLimit: number;
  private readonly staticDir: string | undefined;
  private readonly insights: Insights | undefined;
  private readonly recommendations: RecommendationStore | undefined;
  private readonly version: BuildVersion;
  private readonly marketplace: string | undefined;
  private readonly settings: SettingsSection[];
  private readonly amazonCheck: AmazonCheck | undefined;
  private readonly stuffing: StuffingSettings | undefined;
  private readonly effect: EffectSettings | undefined;
  private readonly themeTest: ThemeTestSettings | undefined;
  private readonly defaultTheme: string;
  private readonly recommendationEnabled: boolean;

  constructor(stats: Stats, options: AdminOptions) {
    AdminApi.checkPassword(options.password);
    this.log = getLogger("AdminApi");
    this.stats = stats;
    // Only a scrypt key is kept: comparisons then run on equal-length buffers and
    // a memory dump does not reveal the password
    this.passwordSalt = crypto.randomBytes(16);
    // eslint-disable-next-line no-sync -- runs once at startup
    this.passwordKey = crypto.scryptSync(options.password, this.passwordSalt, AdminApi.KEY_LENGTH);
    this.secret = options.secret ? Buffer.from(options.secret, 'utf8') : crypto.randomBytes(32);
    this.tokenTtl = options.tokenTtl && options.tokenTtl > 0 ? options.tokenTtl : AdminApi.DEFAULT_TOKEN_TTL;
    this.loginRateLimit = options.loginRateLimit && options.loginRateLimit > 0
      ? options.loginRateLimit
      : AdminApi.DEFAULT_LOGIN_RATE_LIMIT;
    this.staticDir = options.staticDir;
    this.insights = options.insights;
    this.recommendations = options.recommendations;
    this.version = options.version ?? { release: '', revision: null, buildDate: null };
    this.settings = options.settings ?? [];
    this.amazonCheck = options.amazonCheck;
    this.stuffing = options.stuffing;
    this.effect = options.effect;
    this.themeTest = options.themeTest;
    this.defaultTheme = options.defaultTheme ?? 'default';
    this.recommendationEnabled = options.recommendationEnabled === true;
    // A host only: anything else would turn the links into another site
    this.marketplace = options.marketplace && AdminApi.MARKETPLACE.test(options.marketplace) ? options.marketplace : undefined;
    // eslint-disable-next-line no-sync -- runs once at startup
    if (this.staticDir && !fs.existsSync(path.join(this.staticDir, 'index.html'))) {
      this.log.warn(`Admin portal not found in ${this.staticDir}, run "npm run build"`);
      this.staticDir = undefined;
    }
  }

  /**
   * Builds the administration API from the settings, or returns undefined
   * when it is disabled. Throws when it is enabled without a strong password,
   * so that the server refuses to start rather than exposing the statistics.
   */
  public static fromSettings(stats: Stats, settings: Settings, env: NodeJS.ProcessEnv = process.env, release = '', cache?: Redis, stuffing?: StuffingSettings, effect?: EffectSettings, themeTest?: ThemeTestSettings): AdminApi | undefined {
    if (!settings.admin.enabled) {
      return undefined;
    }

    return new AdminApi(stats, {
      password: env.AMW_ADMIN_PASSWORD || '',
      secret: env.AMW_ADMIN_SECRET,
      tokenTtl: settings.admin.tokenTtl,
      loginRateLimit: settings.admin.loginRateLimit,
      staticDir: path.join(settings.server.projectDir, 'dist', 'admin'),
      insights: settings.admin.insights ? new Insights(stats) : undefined,
      recommendations: settings.recommendation.enabled && cache ? new RecommendationStore(cache) : undefined,
      version: {
        release,
        // Build arguments of the image: only a commit hash and an ISO date are shown
        revision: /^[0-9a-f]{7,40}$/.test(env.AMW_REVISION ?? '') ? env.AMW_REVISION as string : null,
        buildDate: env.AMW_BUILD_DATE && !Number.isNaN(Date.parse(env.AMW_BUILD_DATE)) ? env.AMW_BUILD_DATE : null
      },
      marketplace: settings.amazon.marketplace,
      settings: describeSettings(settings, env),
      stuffing: stuffing ?? new StuffingSettings(settings.stuffing),
      effect: effect ?? new EffectSettings(settings.effect),
      themeTest: themeTest ?? new ThemeTestSettings(),
      defaultTheme: settings.server.theme,
      recommendationEnabled: settings.recommendation.enabled,
      amazonCheck: new AmazonCheck({
        search: () => new Paapi(settings),
        marketplace: settings.amazon.marketplace,
        partnerTag: settings.amazon.partnerTag
      })
    });
  }

  /**
   * Router to mount on <path>/admin.
   */
  public router(): Router {
    const router = express.Router();

    router.use((req: Request, res: Response, next: NextFunction) => {
      noStore(res);
      res.set({
        'Content-Security-Policy': AdminApi.CONTENT_SECURITY_POLICY,
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY'
      });
      next();
    });

    // Failed attempts only, so a legitimate admin is not locked out by their own logins
    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: this.loginRateLimit,
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false
    });
    router.post('/api/login', loginLimiter, express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.login(req, res);
    });

    // Also bounds token guessing, on top of the HMAC
    const apiLimiter = rateLimit({
      windowMs: 60 * 1000,
      limit: AdminApi.API_RATE_LIMIT,
      standardHeaders: 'draft-8',
      legacyHeaders: false
    });
    router.use('/api', apiLimiter, (req: Request, res: Response, next: NextFunction) => {
      this.authenticate(req, res, next);
    });

    router.get('/api/status', (req: Request, res: Response) => {
      res.status(200).json({
        stats: this.stats.enabled,
        message: this.stats.enabled ? undefined : AdminApi.STATS_UNAVAILABLE,
        retentionDays: Stats.RETENTION_DAYS,
        // Behind authentication: the exact build is no information for anonymous visitors
        version: this.version
      });
    });

    // Works without Redis, unlike the statistics: it helps finding out why they are unavailable
    router.get('/api/settings', (req: Request, res: Response) => {
      res.status(200).json(this.settings);
    });

    router.get('/api/effect', (req: Request, res: Response) => {
      this.sendEffect(res);
    });

    router.put('/api/effect', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveEffect(req, res);
    });

    router.get('/api/stats/effects', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getEffects(this.days(req)));
    });

    router.get('/api/theme-test', (req: Request, res: Response) => {
      this.sendThemeTest(res);
    });

    router.put('/api/theme-test', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveThemeTest(req, res);
    });

    router.get('/api/stats/themes', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getThemes(this.days(req)));
    });

    router.get('/api/stuffing', (req: Request, res: Response) => {
      this.sendStuffing(res);
    });

    router.put('/api/stuffing', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveStuffing(req, res);
    });

    // A POST: each check uses a call of the Amazon quota
    router.post('/api/amazon/test', (req: Request, res: Response) => {
      this.testAmazon(res);
    });

    router.get('/api/stats/daily', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDaily(this.days(req)));
    });

    router.get('/api/stats/products', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getTopProducts(this.days(req), this.limit(req)));
    });

    router.get('/api/stats/products/count', (req: Request, res: Response) => {
      this.withStats(res, async () => ({ count: await this.stats.countProducts(this.days(req)) }));
    });

    router.get('/api/stats/pages', (req: Request, res: Response) => {
      const sort = req.query.sort ?? 'clicks';
      if (!PAGE_SORTS.includes(sort as PageSort)) {
        res.status(400).json({ error: 'Bad Request', message: `sort must be one of: ${PAGE_SORTS.join(', ')}` });
        return;
      }
      const domain = req.query.domain;
      if (domain !== undefined && (typeof domain !== 'string' || !AdminApi.HOSTNAME.test(domain))) {
        res.status(400).json({ error: 'Bad Request', message: 'domain must be a hostname' });
        return;
      }
      this.withStats(res, () => this.stats.getTopPages(this.days(req), this.limit(req), sort as PageSort, domain));
    });

    router.get('/api/stats/domains', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDomains(this.days(req)));
    });

    router.get('/api/stats/domains/daily', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDomainTrends(this.days(req), AdminApi.boundedInt(req.query.limit, 5, 20)));
    });

    router.get('/api/stats/notfound', (req: Request, res: Response) => {
      this.withStats(res, async () => (await this.stats.getNotFound(this.limit(req)))
        .map(product => ({ ...product, url: this.amazonUrl(product.type, product.value) })));
    });

    router.get('/api/stats/llm', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getLlmUsage(this.days(req)));
    });

    // Reading never calls Claude; generating is a paid call, hence a POST
    router.get('/api/insights', (req: Request, res: Response) => {
      this.sendInsights(req, res, false);
    });

    router.post('/api/insights', (req: Request, res: Response) => {
      this.sendInsights(req, res, true);
    });

    router.get('/api/recommendations', (req: Request, res: Response) => {
      this.sendRecommendations(req, res);
    });

    router.put('/api/recommendations/:hash', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.updateRecommendation(req, res);
    });

    if (this.staticDir) {
      this.servePortal(router, this.staticDir);
    }

    return router;
  }

  /**
   * Creates a token "<expiry>.<signature>" valid for tokenTtl seconds.
   */
  public createToken(now: number = Date.now()): { token: string; expiresAt: string } {
    const expiry = now + this.tokenTtl * 1000;
    return {
      token: `${expiry}.${this.sign(String(expiry))}`,
      expiresAt: new Date(expiry).toISOString()
    };
  }

  public verifyToken(token: string, now: number = Date.now()): boolean {
    const [expiry, signature, ...rest] = token.split('.');
    if (!expiry || !signature || rest.length > 0 || !/^\d+$/.test(expiry)) {
      return false;
    }

    const expected = Buffer.from(this.sign(expiry), 'utf8');
    const received = Buffer.from(signature, 'utf8');
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return false;
    }
    return Number(expiry) > now;
  }

  /**
   * The portal is public static files: it holds no secret and every piece of
   * data comes from the authenticated API.
   */
  private servePortal(router: Router, staticDir: string): void {
    router.get('/', (req: Request, res: Response) => {
      // Assets are referenced relatively, so <path>/admin must become <path>/admin/
      if (!req.originalUrl.split('?')[0].endsWith('/')) {
        res.redirect(302, `${req.baseUrl}/`);
        return;
      }
      // root keeps send's dotfile check off the install path (e.g. a hidden parent directory)
      res.sendFile('index.html', { root: staticDir });
    });
    router.use(express.static(staticDir, { index: false, redirect: false }));
  }

  private async login(req: Request, res: Response): Promise<void> {
    const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';
    const key = await AdminApi.scrypt(password, this.passwordSalt, AdminApi.KEY_LENGTH);
    if (!crypto.timingSafeEqual(key, this.passwordKey)) {
      this.log.warn('Admin login failed');
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid password' });
      return;
    }

    this.log.info('Admin login succeeded');
    res.status(200).json(this.createToken());
  }

  private authenticate(req: Request, res: Response, next: NextFunction): void {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !this.verifyToken(token)) {
      res.status(401).json({ error: 'Unauthorized', message: 'Missing or expired token' });
      return;
    }
    next();
  }

  private async withStats(res: Response, query: () => Promise<unknown>): Promise<void> {
    if (!this.stats.enabled) {
      res.status(503).json({ error: 'Service Unavailable', message: AdminApi.STATS_UNAVAILABLE });
      return;
    }

    try {
      res.status(200).json(await query());
    } catch (error) {
      this.log.error('Failed to read statistics:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'Statistics are temporarily unavailable' });
    }
  }

  private async sendEffect(res: Response): Promise<void> {
    if (!this.effect) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The effect setting is not available' });
      return;
    }
    await this.effect.refresh();
    res.status(200).json({ ...this.effect.current(), editable: this.effect.editable });
  }

  private async saveEffect(req: Request, res: Response): Promise<void> {
    if (!this.effect?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis' });
      return;
    }
    try {
      const saved = await this.effect.save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `mode must be one of: ${EFFECT_MODES.join(', ')}, and effects a list of two effects at least to compare` });
        return;
      }
      this.log.info(`Effect changed: ${saved.mode}${saved.mode === 'compare' ? ` (${saved.effects.join(', ')})` : ''}`);
      res.status(200).json({ ...saved, editable: true });
    } catch (error) {
      this.log.error('Failed to save the effect:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private async sendThemeTest(res: Response): Promise<void> {
    if (!this.themeTest) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The theme test setting is not available' });
      return;
    }
    await this.themeTest.refresh();
    res.status(200).json({ ...this.themeTest.current(), defaultTheme: this.defaultTheme, editable: this.themeTest.editable });
  }

  private async saveThemeTest(req: Request, res: Response): Promise<void> {
    if (!this.themeTest?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis' });
      return;
    }
    try {
      const saved = await this.themeTest.save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `mode must be one of: ${THEME_TEST_MODES.join(', ')}, and themes a list of two known themes at least to compare` });
        return;
      }
      this.log.info(`Theme test changed: ${saved.mode}${saved.mode === 'compare' ? ` (${saved.themes.join(', ')})` : ''}`);
      res.status(200).json({ ...saved, defaultTheme: this.defaultTheme, editable: true });
    } catch (error) {
      this.log.error('Failed to save the theme test:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private async sendStuffing(res: Response): Promise<void> {
    if (!this.stuffing) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Stuffing settings are not available' });
      return;
    }
    await this.stuffing.refresh();
    res.status(200).json({ ...this.stuffing.current(), editable: this.stuffing.editable, recommendationEnabled: this.recommendationEnabled });
  }

  private async saveStuffing(req: Request, res: Response): Promise<void> {
    if (!this.stuffing?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing these settings requires Redis' });
      return;
    }
    // Recommended cards would otherwise all stay hidden; manual ones never call the AI model
    if (req.body?.count > 0 && req.body?.mode !== 'manual' && !this.recommendationEnabled) {
      res.status(400).json({ error: 'Bad Request', message: 'Recommended cards need Recommendation.enabled: choose the manual mode' });
      return;
    }
    try {
      const saved = await this.stuffing.save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `count must be an integer from 0 to ${MAX_STUFFED_CARDS}, mode recommendation or manual, containerId an HTML id, and products at most ${MAX_STUFFING_PRODUCTS} ASINs` });
        return;
      }
      this.log.info(`Stuffing settings changed: ${saved.count} ${saved.mode} cards in #${saved.containerId}, ${saved.products.length} products`);
      res.status(200).json({ ...saved, editable: true, recommendationEnabled: this.recommendationEnabled });
    } catch (error) {
      this.log.error('Failed to save the stuffing settings:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The settings could not be saved' });
    }
  }

  private async testAmazon(res: Response): Promise<void> {
    if (!this.amazonCheck) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The Amazon test is not available' });
      return;
    }
    const result = await this.amazonCheck.run();
    this.log.info(`Amazon test: ${result.ok ? 'ok' : result.failure}`);
    // 200 whatever the result: the check ran, and the failure of Amazon is its answer
    res.status(200).json(result);
  }

  private async sendInsights(req: Request, res: Response, generate: boolean): Promise<void> {
    if (!this.insights) {
      res.status(200).json({ available: false, reason: AdminApi.INSIGHTS_DISABLED });
      return;
    }
    if (!this.stats.enabled) {
      res.status(503).json({ error: 'Service Unavailable', message: AdminApi.STATS_UNAVAILABLE });
      return;
    }

    try {
      const days = this.days(req);
      if (!generate) {
        res.status(200).json(await this.insights.latest(days) ?? { available: true, days, missing: true });
        return;
      }
      res.status(200).json(await this.insights.report(days));
    } catch (error) {
      this.log.error('Failed to generate insights:', error);
      // The SDK errors may carry request details: only our own messages reach the portal
      const message = error instanceof InsightsError ? error.message : 'The Claude API could not be reached, check ANTHROPIC_API_KEY';
      res.status(502).json({ error: 'Bad Gateway', message });
    }
  }

  private async sendRecommendations(req: Request, res: Response): Promise<void> {
    if (!this.recommendations) {
      res.status(200).json({ available: false, reason: AdminApi.RECOMMENDATIONS_DISABLED });
      return;
    }
    try {
      const { total, items } = await this.recommendations.list(AdminApi.boundedInt(req.query.limit, AdminApi.MAX_LIMIT, AdminApi.MAX_LIMIT));
      res.status(200).json({ available: true, total, items: items.map(item => this.withSearchUrl(item)) });
    } catch (error) {
      this.log.error('Failed to read the recommendations:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'Recommendations are temporarily unavailable' });
    }
  }

  private async updateRecommendation(req: Request, res: Response): Promise<void> {
    if (!this.recommendations) {
      res.status(404).json({ error: 'Not Found', message: AdminApi.RECOMMENDATIONS_DISABLED });
      return;
    }
    const hash = String(req.params.hash);
    const product: unknown = req.body?.product;
    if (!PAGE_HASH_PATTERN.test(hash) || (product !== null && typeof product !== 'string')) {
      res.status(400).json({ error: 'Bad Request', message: 'Expected a page hash and { "product": keywords or null }' });
      return;
    }
    try {
      const updated = await this.recommendations.update(hash, product);
      if (!updated) {
        res.status(404).json({ error: 'Not Found', message: 'This page has no recommendation' });
        return;
      }
      this.log.info(`Recommendation of ${updated.url} edited: ${updated.product ?? 'none'}`);
      res.status(200).json(this.withSearchUrl(updated));
    } catch (error) {
      if (error instanceof InvalidKeywordsError) {
        res.status(400).json({ error: 'Bad Request', message: error.message });
        return;
      }
      this.log.error('Failed to edit a recommendation:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'Recommendations are temporarily unavailable' });
    }
  }

  private withSearchUrl(item: RecommendationEntry) {
    return { ...item, searchUrl: item.product ? this.amazonUrl('keyword', item.product) : undefined };
  }

  /**
   * Amazon page of a missing product, to check it before replacing it. The partner
   * tag is left out: the operator's own visits are not affiliate traffic.
   */
  private amazonUrl(type: 'id' | 'keyword', value: string): string | undefined {
    if (!this.marketplace) return undefined;
    return type === 'id'
      ? `https://${this.marketplace}/dp/${encodeURIComponent(value)}`
      : `https://${this.marketplace}/s?k=${encodeURIComponent(value)}`;
  }

  private days(req: Request): number {
    return AdminApi.boundedInt(req.query.days, AdminApi.DEFAULT_DAYS, Stats.RETENTION_DAYS);
  }

  private limit(req: Request): number {
    return AdminApi.boundedInt(req.query.limit, AdminApi.DEFAULT_LIMIT, AdminApi.MAX_LIMIT);
  }

  private sign(value: string): string {
    return crypto.createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private static boundedInt(value: unknown, fallback: number, max: number): number {
    const parsed = typeof value === 'string' ? parseInt(value, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
  }

  private static checkPassword(password: string): void {
    if (!password) {
      throw new Error('Admin is enabled but AMW_ADMIN_PASSWORD is not set');
    }
    if (password.length < AdminApi.MIN_PASSWORD_LENGTH) {
      throw new Error(`AMW_ADMIN_PASSWORD must be at least ${AdminApi.MIN_PASSWORD_LENGTH} characters long`);
    }
  }
}

export { AdminApi };
export type { AdminOptions };
