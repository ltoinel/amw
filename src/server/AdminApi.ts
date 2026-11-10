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
import { Stats, noStore, PAGE_SORTS, type PageSort, type Period } from "./Stats";
import { BUTTON_LABELS, describeSettings, EFFECT_MODES, WIDGET_EFFECTS, SITE_HOST, WIDGET_THEMES, MAX_STUFFED_CARDS, MAX_STUFFING_PRODUCTS, THEME_TEST_MODES, type Settings, type SettingsSection } from "./Settings";
import type { Redis } from "ioredis";
import { Insights, InsightsError } from "./Insights";
import { InvalidKeywordsError, RecommendationEntry, RecommendationStore } from "./RecommendationStore";
import { ASIN_PATTERN, PAGE_HASH_PATTERN } from "./Schemas";
import { AmazonCheck } from "./AmazonCheck";
import { ButtonLabelSettings, EffectSettings, StuffingSettings, ThemeTestSettings } from "./StuffingSettings";
import { SiteScopedSetting } from "./SiteScopedSetting";
import { SiteSettings, type Site } from "./SiteSettings";
import type { RuntimeSetting } from "./RuntimeSetting";
import { Tunables } from "./Tunables";
import { createIpFilter } from "./IpFilter";
import { Paapi } from "./Paapi";

interface AdminOptions {
  password: string;
  // Tokens signed with a random secret are lost on restart, which only forces a new login
  secret?: string;
  tokenTtl?: number;
  loginRateLimit?: number;
  // Addresses or CIDR ranges that may reach the portal; empty or missing allows every address
  allowedIps?: string[];
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
  // The label of the card button, or the labels compared, editable in the portal
  buttonLabel?: ButtonLabelSettings;
  // Server.theme: the control group of a theme A/B test
  defaultTheme?: string;
  recommendationEnabled?: boolean;
  // The sites served, with their tracking IDs, editable in the portal
  sites?: SiteSettings;
  // Amazon.partnerTag: the tracking ID of the other sites
  defaultPartnerTag?: string;
  // Theme, caching, rate limits and AI pauses, editable in the portal
  tunables?: Tunables;
  // Products by ASIN, for the previews of the portal: the cache, then Amazon
  products?: ProductLookup;
}

type ProductLookup = (ids: string[]) => Promise<{ id: string; status: number; product?: { title?: string; image?: string; url?: string } }[]>;

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
  // 10 days: an admin who closes the browser stays logged in (the portal keeps the token in localStorage)
  private static readonly DEFAULT_TOKEN_TTL: number = 10 * 24 * 3600;
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
  private static readonly INSIGHTS_PAUSED: string = 'AI insights are paused in the Settings view';
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

  // The product of the preview cards: a drawing, so that no Amazon image or call is involved
  private static readonly PREVIEW_IMAGE: string = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500">' +
    '<rect width="500" height="500" fill="#f1f1f6"/>' +
    '<path d="M120 300v-60a130 130 0 0 1 260 0v60" fill="none" stroke="#3f3d56" stroke-width="26" stroke-linecap="round"/>' +
    '<rect x="90" y="270" width="80" height="130" rx="34" fill="#6d28d9"/><rect x="330" y="270" width="80" height="130" rx="34" fill="#6d28d9"/></svg>';

  private readonly log: Logger;
  private readonly stats: Stats;
  private readonly passwordSalt: Buffer;
  private readonly passwordKey: Buffer;
  private readonly secret: Buffer;
  private readonly tokenTtl: number;
  private readonly loginRateLimit: number;
  private readonly allowedIps: string[];
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
  private readonly buttonLabel: ButtonLabelSettings | undefined;
  private readonly defaultTheme: string;
  private readonly recommendationEnabled: boolean;
  private readonly sites: SiteSettings | undefined;
  private readonly tunables: Tunables | undefined;
  private readonly products: ProductLookup | undefined;
  private readonly defaultPartnerTag: string;

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
    this.allowedIps = options.allowedIps ?? [];
    this.staticDir = options.staticDir;
    this.insights = options.insights;
    this.recommendations = options.recommendations;
    this.version = options.version ?? { release: '', revision: null, buildDate: null };
    this.settings = options.settings ?? [];
    this.amazonCheck = options.amazonCheck;
    this.stuffing = options.stuffing;
    this.effect = options.effect;
    this.themeTest = options.themeTest;
    this.buttonLabel = options.buttonLabel;
    this.defaultTheme = options.defaultTheme ?? 'default';
    this.recommendationEnabled = options.recommendationEnabled === true;
    this.sites = options.sites;
    this.tunables = options.tunables;
    this.products = options.products;
    this.defaultPartnerTag = options.defaultPartnerTag ?? '';
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
  public static fromSettings(stats: Stats, settings: Settings, env: NodeJS.ProcessEnv = process.env, release = '', cache?: Redis, stuffing?: StuffingSettings, effect?: EffectSettings, themeTest?: ThemeTestSettings, sites?: SiteSettings, tunables?: Tunables, products?: ProductLookup, buttonLabel?: ButtonLabelSettings): AdminApi | undefined {
    if (!settings.admin.enabled) {
      return undefined;
    }

    return new AdminApi(stats, {
      password: env.AMW_ADMIN_PASSWORD || '',
      secret: env.AMW_ADMIN_SECRET,
      tokenTtl: settings.admin.tokenTtl,
      loginRateLimit: settings.admin.loginRateLimit,
      allowedIps: settings.admin.allowedIps,
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
      buttonLabel: buttonLabel ?? new ButtonLabelSettings(),
      defaultTheme: settings.server.theme,
      recommendationEnabled: settings.recommendation.enabled,
      sites: sites ?? new SiteSettings(settings),
      defaultPartnerTag: settings.amazon.partnerTag,
      tunables: tunables ?? new Tunables(settings),
      products,
      amazonCheck: new AmazonCheck({
        search: () => new Paapi(settings, () => stats.recordAmazonCall()),
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

    // First: other addresses do not even reach the login and its rate limiter
    router.use(createIpFilter(this.allowedIps));

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

    // Public like the portal's files: a sample card, no data. The portal frames it, hence its own headers.
    router.get('/preview', (req: Request, res: Response) => {
      this.sendPreview(req, res);
    });
    router.get('/preview.svg', (req: Request, res: Response) => {
      res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
      res.send(AdminApi.PREVIEW_IMAGE);
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
      this.sendEffect(req, res);
    });

    router.put('/api/effect', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveEffect(req, res);
    });

    router.get('/api/stats/effects', (req: Request, res: Response) => {
      this.withSite(req, res, site => this.stats.getEffects(this.days(req), site));
    });

    router.get('/api/sites', (req: Request, res: Response) => {
      this.sendSites(res);
    });

    // 50 sites with a description and a URL each
    router.put('/api/sites', express.json({ limit: '64kb' }), (req: Request, res: Response) => {
      this.saveSites(req, res);
    });

    router.get('/api/theme-test', (req: Request, res: Response) => {
      this.sendThemeTest(req, res);
    });

    router.put('/api/theme-test', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveThemeTest(req, res);
    });

    router.get('/api/stats/themes', (req: Request, res: Response) => {
      this.withSite(req, res, site => this.stats.getThemes(this.days(req), site));
    });

    router.get('/api/button-label', (req: Request, res: Response) => {
      this.sendButtonLabel(req, res);
    });

    router.put('/api/button-label', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveButtonLabel(req, res);
    });

    router.get('/api/stats/labels', (req: Request, res: Response) => {
      this.withSite(req, res, site => this.stats.getLabels(this.days(req), site));
    });

    router.get('/api/stuffing', (req: Request, res: Response) => {
      this.sendStuffing(req, res);
    });

    router.put('/api/stuffing', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveStuffing(req, res);
    });

    // The list alone: the products page must not overwrite what the Stuffing view changed meanwhile
    router.put('/api/stuffing/products', express.json({ limit: '1kb' }), (req: Request, res: Response) => {
      this.saveStuffingProducts(req, res);
    });

    // Uses the Amazon quota for the products not in the cache: the portal asks for the new ones only
    router.get('/api/products', (req: Request, res: Response) => {
      this.sendProducts(req, res);
    });

    router.get('/api/tunables', (req: Request, res: Response) => {
      this.sendTunables(res);
    });

    router.put('/api/tunables', express.json({ limit: '2kb' }), (req: Request, res: Response) => {
      this.saveTunables(req, res);
    });

    router.get('/api/settings/export', (req: Request, res: Response) => {
      this.exportSettings(res);
    });

    // Larger than one form: the whole backup at once
    router.post('/api/settings/import', express.json({ limit: '16kb' }), (req: Request, res: Response) => {
      this.importSettings(req, res);
    });

    // A POST: each check uses a call of the Amazon quota
    router.post('/api/amazon/test', (req: Request, res: Response) => {
      this.testAmazon(res);
    });

    // ?site= limits the figures to a site of the Sites page, counted since sites have their own
    router.get('/api/stats/daily', (req: Request, res: Response) => {
      this.withSite(req, res, site => this.stats.getDaily(this.days(req), site));
    });

    router.get('/api/stats/products', (req: Request, res: Response) => {
      const sort = this.sort(req, res, 'impressions');
      if (!sort) return;
      this.withSite(req, res, site => this.stats.getTopProducts(this.days(req), this.limit(req), site, sort));
    });

    router.get('/api/stats/products/count', (req: Request, res: Response) => {
      this.withSite(req, res, async site => ({ count: await this.stats.countProducts(this.days(req), site) }));
    });

    router.get('/api/stats/pages', (req: Request, res: Response) => {
      const sort = this.sort(req, res, 'clicks');
      if (!sort) return;
      const domain = req.query.domain;
      if (domain !== undefined && (typeof domain !== 'string' || !AdminApi.HOSTNAME.test(domain))) {
        res.status(400).json({ error: 'Bad Request', message: 'domain must be a hostname' });
        return;
      }
      this.withSite(req, res, site => this.stats.getTopPages(this.days(req), this.limit(req), sort, site ?? domain));
    });

    router.get('/api/stats/domains', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDomains(this.days(req)));
    });

    router.get('/api/stats/domains/daily', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDomainTrends(this.days(req), AdminApi.boundedInt(req.query.limit, 5, 20)));
    });

    router.get('/api/stats/notfound', (req: Request, res: Response) => {
      this.withSite(req, res, async site => (await this.stats.getNotFound(this.limit(req), site, this.days(req)))
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
   * A page with one sample card in the theme, effect and label to preview: the real widget.js,
   * in its preview mode, which sends no request and no beacon. Only known names get in.
   */
  private sendPreview(req: Request, res: Response): void {
    const pick = <T extends string>(value: unknown, known: readonly T[]): T | undefined => known.find(name => name === value);
    const theme = pick(req.query.theme, WIDGET_THEMES) ?? 'default';
    const effect = pick(req.query.effect, WIDGET_EFFECTS);
    const label = pick(req.query.label, BUTTON_LABELS);
    const lang = typeof req.query.lang === 'string' && /^[a-z]{2}$/.test(req.query.lang) ? req.query.lang : 'en';
    const preview = {
      theme, ...(effect ? { effect } : {}), ...(label ? { label } : {}),
      product: { title: 'Wireless Noise Cancelling Headphones, 40 h battery', price: '89,99 €', savings: 25, image: 'preview.svg', url: 'https://www.amazon.com/' },
    };
    const attribute = JSON.stringify(preview).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Type': 'text/html; charset=utf-8',
    });
    res.send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preview</title></head>` +
      `<body style="margin:0;padding:8px 2px;background:transparent;overflow:hidden"><div class="amw" id="B0PREVIEW1" data-lang="${lang}"></div>` +
      `<script src="../widget.js" data-preview='${attribute}'></script></body></html>`);
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

  private async sendEffect(req: Request, res: Response): Promise<void> {
    if (!this.effect) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The effect setting is not available' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    res.status(200).json({ ...await this.siteValue(this.effect, site), editable: this.effect.editable });
  }

  private async saveEffect(req: Request, res: Response): Promise<void> {
    if (!this.effect?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis or Admin.settingsFile' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    if (await this.refuseSecondTest(req.body, 'effect', site, res)) return;
    try {
      const saved = await this.scope(this.effect).of(site || undefined).save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `mode must be one of: ${EFFECT_MODES.join(', ')}, and effects a list of two effects at least to compare` });
        return;
      }
      this.log.info(`Effect changed: ${saved.mode}${saved.mode === 'compare' ? ` (${saved.effects.join(', ')})` : ''}`);
      res.status(200).json({ ...saved, ...(site ? { own: true } : {}), editable: true });
    } catch (error) {
      this.log.error('Failed to save the effect:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private async sendSites(res: Response): Promise<void> {
    if (!this.sites) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The sites are not available' });
      return;
    }
    await this.sites.refresh();
    res.status(200).json(this.sitesBody(this.sites));
  }

  private async saveSites(req: Request, res: Response): Promise<void> {
    if (!this.sites?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis or Admin.settingsFile' });
      return;
    }
    try {
      const saved = await this.sites.save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: 'sites must list distinct hosts such as www.example.com, with an optional description, http(s) URL and tracking ID such as mysite-21' });
        return;
      }
      this.log.info(`Sites changed: ${saved.sites.map(site => site.partnerTag ? `${site.host}=${site.partnerTag}` : site.host).join(', ') || 'none, every site allowed'}`);
      res.status(200).json(this.sitesBody(this.sites));
    } catch (error) {
      this.log.error('Failed to save the sites:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private sitesBody(sites: SiteSettings): { sites: Site[]; saved: boolean; defaultTag: string; recommendationEnabled: boolean; editable: boolean } {
    return { sites: sites.list, saved: sites.saved, defaultTag: this.defaultPartnerTag, recommendationEnabled: this.recommendationEnabled, editable: sites.editable };
  }

  /** The sites that may get their own number of Stuffing cards. */
  private get allowedSites(): string[] {
    return this.sites?.recommendationHosts ?? [];
  }

  private async sendThemeTest(req: Request, res: Response): Promise<void> {
    if (!this.themeTest) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The theme test setting is not available' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    res.status(200).json({ ...await this.siteValue(this.themeTest, site), defaultTheme: this.defaultTheme, editable: this.themeTest.editable });
  }

  private async saveThemeTest(req: Request, res: Response): Promise<void> {
    if (!this.themeTest?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis or Admin.settingsFile' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    if (await this.refuseSecondTest(req.body, 'theme', site, res)) return;
    try {
      const saved = await this.scope(this.themeTest).of(site || undefined).save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `mode must be one of: ${THEME_TEST_MODES.join(', ')}, and themes a list of two known themes at least to compare` });
        return;
      }
      this.log.info(`Theme test changed: ${saved.mode}${saved.mode === 'compare' ? ` (${saved.themes.join(', ')})` : ''}`);
      res.status(200).json({ ...saved, ...(site ? { own: true } : {}), defaultTheme: this.defaultTheme, editable: true });
    } catch (error) {
      this.log.error('Failed to save the theme test:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private async sendButtonLabel(req: Request, res: Response): Promise<void> {
    if (!this.buttonLabel) {
      res.status(503).json({ error: 'Service Unavailable', message: 'The button label is not available' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    res.status(200).json({ ...await this.siteValue(this.buttonLabel, site), editable: this.buttonLabel.editable });
  }

  private async saveButtonLabel(req: Request, res: Response): Promise<void> {
    if (!this.buttonLabel?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing this setting requires Redis or Admin.settingsFile' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    if (await this.refuseSecondTest(req.body, 'label', site, res)) return;
    try {
      const saved = await this.scope(this.buttonLabel).of(site || undefined).save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `label must be one of: ${BUTTON_LABELS.join(', ')}, mode off or compare, and labels a list of two labels at least to compare` });
        return;
      }
      this.log.info(`Button label changed: ${saved.label}${saved.mode === 'compare' ? `, comparing ${saved.labels.join(', ')}` : ''}`);
      res.status(200).json({ ...saved, ...(site ? { own: true } : {}), editable: true });
    } catch (error) {
      this.log.error('Failed to save the button label:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The setting could not be saved' });
    }
  }

  private readonly scopes = new Map<RuntimeSetting<unknown>, SiteScopedSetting<unknown>>();

  /** The setting of each site, over the setting of every site. */
  private scope<T>(setting: RuntimeSetting<T>): SiteScopedSetting<T> {
    let scoped = this.scopes.get(setting as RuntimeSetting<unknown>);
    if (!scoped) {
      scoped = new SiteScopedSetting(setting as RuntimeSetting<unknown>);
      this.scopes.set(setting as RuntimeSetting<unknown>, scoped);
    }
    return scoped as SiteScopedSetting<T>;
  }

  /**
   * The site of a settings request: a host of the portal, or '' for every site; null once a 400
   * has been sent for a value that is not a host.
   */
  private settingSite(req: Request, res: Response): string | null {
    const site = req.query.site;
    if (site === undefined || site === '') return '';
    if (typeof site !== 'string' || !SITE_HOST.test(site)) {
      res.status(400).json({ error: 'Bad Request', message: 'site must be a host such as www.example.com' });
      return null;
    }
    return site;
  }

  /** The value of a setting for a site, and whether the site set its own. */
  private async siteValue<T>(setting: RuntimeSetting<T>, site: string): Promise<T & { own?: boolean }> {
    const scoped = this.scope(setting);
    await scoped.refresh(site ? [site] : []);
    return { ...scoped.current(site || undefined), ...(site ? { own: scoped.isOwn(site) } : {}) };
  }

  /** The A/B test running among themes, effects and labels, if any. */
  /** @param site The site whose visitors would see both tests; '' for every site. */
  private async runningTest(site: string): Promise<'theme' | 'effect' | 'label' | null> {
    const of = async <T>(setting: RuntimeSetting<T> | undefined) => (setting ? (await this.siteValue(setting, site)) : undefined);
    const [themeTest, effect, buttonLabel] = await Promise.all([of(this.themeTest), of(this.effect), of(this.buttonLabel)]);
    if (themeTest?.mode === 'compare') return 'theme';
    if (effect?.mode === 'compare') return 'effect';
    if (buttonLabel?.mode === 'compare') return 'label';
    return null;
  }

  /**
   * Two tests at once mix their effects: a click could not be put down to the theme or to the
   * label. Starting a test while another one runs is refused; changing the running one is not.
   * @returns Whether the request was answered.
   */
  private async refuseSecondTest(body: unknown, kind: 'theme' | 'effect' | 'label', site: string, res: Response): Promise<boolean> {
    const starts = typeof body === 'object' && body !== null && (body as { mode?: unknown }).mode === 'compare';
    const running = starts ? await this.runningTest(site) : null;
    if (running === null || running === kind) return false;
    res.status(409).json({ error: 'Conflict', message: `A ${running} test is running: stop it before starting a ${kind} test, as two tests at once mix their results` });
    return true;
  }

  private async sendStuffing(req: Request, res: Response): Promise<void> {
    if (!this.stuffing) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Stuffing settings are not available' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    await this.sites?.refresh();
    res.status(200).json({ ...await this.siteValue(this.stuffing, site), editable: this.stuffing.editable, recommendationEnabled: this.recommendationEnabled, allowedSites: this.allowedSites });
  }

  private async saveStuffing(req: Request, res: Response): Promise<void> {
    if (!this.stuffing?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing these settings requires Redis or Admin.settingsFile' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    if (this.lacksRecommendations(req.body)) {
      res.status(400).json({ error: 'Bad Request', message: 'Recommended cards need Recommendation.enabled: choose the best products of the site or a custom list' });
      return;
    }
    try {
      const saved = await this.scope(this.stuffing).of(site || undefined).save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: `count must be an integer from 0 to ${MAX_STUFFED_CARDS}, mode recommendation, popular, manual or deals (with keywords), containerId an HTML id, products at most ${MAX_STUFFING_PRODUCTS} ASINs, and sites a map of hosts to numbers of cards` });
        return;
      }
      this.log.info(`Stuffing settings changed${site ? ` for ${site}` : ''}: ${saved.count} ${saved.mode} cards in #${saved.containerId}, ${saved.products.length} products, ${Object.keys(saved.sites).length} sites with their own number`);
      res.status(200).json({ ...saved, ...(site ? { own: true } : {}), editable: true, recommendationEnabled: this.recommendationEnabled, allowedSites: this.allowedSites });
    } catch (error) {
      this.log.error('Failed to save the stuffing settings:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The settings could not be saved' });
    }
  }

  /** Replaces the custom products of the site, keeping its other Stuffing settings. */
  private async saveStuffingProducts(req: Request, res: Response): Promise<void> {
    if (!this.stuffing?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing these settings requires Redis or Admin.settingsFile' });
      return;
    }
    const site = this.settingSite(req, res);
    if (site === null) return;
    const products: unknown = req.body?.products;
    if (!Array.isArray(products) || products.length > MAX_STUFFING_PRODUCTS || !products.every(id => typeof id === 'string' && ASIN_PATTERN.test(id))
      || new Set(products).size !== products.length) {
      res.status(400).json({ error: 'Bad Request', message: `products must be at most ${MAX_STUFFING_PRODUCTS} different ASINs` });
      return;
    }
    try {
      const scoped = this.scope(this.stuffing);
      await scoped.refresh(site ? [site] : []);
      const saved = await scoped.of(site || undefined).save({ ...scoped.current(site || undefined), products });
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: 'The Stuffing settings of this site are not valid: fix them in the Stuffing view first' });
        return;
      }
      this.log.info(`Custom products changed${site ? ` for ${site}` : ''}: ${saved.products.length} products`);
      res.status(200).json({ ...saved, ...(site ? { own: true } : {}), editable: true, recommendationEnabled: this.recommendationEnabled, allowedSites: this.allowedSites });
    } catch (error) {
      this.log.error('Failed to save the custom products:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The settings could not be saved' });
    }
  }

  private tunablesBody(tunables: Tunables) {
    return {
      configured: tunables.configured,
      overrides: tunables.current(),
      effective: tunables.effective,
      themes: WIDGET_THEMES,
      editable: tunables.editable,
    };
  }

  private async sendTunables(res: Response): Promise<void> {
    if (!this.tunables) {
      res.status(503).json({ error: 'Service Unavailable', message: 'These settings are not available' });
      return;
    }
    await this.tunables.refresh();
    res.status(200).json(this.tunablesBody(this.tunables));
  }

  /** The body replaces every override: a setting left out follows the configuration again. */
  private async saveTunables(req: Request, res: Response): Promise<void> {
    if (!this.tunables?.editable) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing these settings requires Redis or Admin.settingsFile' });
      return;
    }
    try {
      const saved = await this.tunables.save(req.body);
      if (!saved) {
        res.status(400).json({ error: 'Bad Request', message: 'theme must be a known theme, httpCache seconds up to a day, the limits positive integers, and recommendations, fallback and insights booleans' });
        return;
      }
      this.log.info(`Live settings changed: ${Object.entries(saved).map(([key, value]) => `${key}=${value}`).join(', ') || 'all from the configuration'}`);
      res.status(200).json(this.tunablesBody(this.tunables));
    } catch (error) {
      this.log.error('Failed to save the live settings:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The settings could not be saved' });
    }
  }

  private async sendProducts(req: Request, res: Response): Promise<void> {
    if (!this.products) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Product previews are not available' });
      return;
    }
    const ids = typeof req.query.ids === 'string' ? req.query.ids.split(',') : [];
    if (ids.length === 0 || ids.length > MAX_STUFFING_PRODUCTS || !ids.every(id => ASIN_PATTERN.test(id))) {
      res.status(400).json({ error: 'Bad Request', message: `ids must list 1 to ${MAX_STUFFING_PRODUCTS} ASINs, separated by commas` });
      return;
    }
    try {
      const results = await this.products([...new Set(ids)]);
      // What a preview shows, and nothing the client could take for a price
      res.status(200).json({
        results: results.map(({ id, status, product }) => (product
          ? { id, status, product: { title: product.title, image: product.image, url: product.url } }
          : { id, status }))
      });
    } catch (error) {
      this.log.error('Failed to look up the products:', error);
      res.status(503).json({ error: 'Service Unavailable', message: 'The products could not be looked up' });
    }
  }

  /** Recommended cards would otherwise all stay hidden; manual ones never call the AI model. */
  private lacksRecommendations(stuffing: { enabled?: unknown; count?: unknown; mode?: unknown; sites?: unknown } | undefined): boolean {
    // Switched off: no card at all
    if (stuffing?.enabled === false) return false;
    const sites: unknown[] = stuffing?.sites && typeof stuffing.sites === 'object' ? Object.values(stuffing.sites) : [];
    const cards = (typeof stuffing?.count === 'number' && stuffing.count > 0) || sites.some(count => typeof count === 'number' && count > 0);
    // Only Claude's recommendations need the feature: the other sources make no Claude call
    return cards && (stuffing?.mode === undefined || stuffing.mode === 'recommendation') && !this.recommendationEnabled;
  }

  /** The settings of the portal, by the name an import expects. */
  private runtimeSettings(): [string, RuntimeSetting<unknown> | undefined][] {
    return [
      ['stuffing', this.stuffing],
      ['effect', this.effect],
      ['themeTest', this.themeTest],
      ['buttonLabel', this.buttonLabel],
      ['sites', this.sites],
      ['tunables', this.tunables],
    ] as [string, RuntimeSetting<unknown> | undefined][];
  }

  private async exportSettings(res: Response): Promise<void> {
    const backup: Record<string, unknown> = { amw: this.version.release, exportedAt: new Date().toISOString() };
    for (const [name, setting] of this.runtimeSettings()) {
      if (setting) {
        await setting.refresh();
        backup[name] = setting.current();
      }
    }
    res.status(200).json(backup);
  }

  /** Checks every section before saving any, so that a bad file changes nothing. */
  private async importSettings(req: Request, res: Response): Promise<void> {
    const body: Record<string, unknown> = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const sections = this.runtimeSettings().filter(([name]) => Object.hasOwn(body, name));
    if (sections.length === 0) {
      res.status(400).json({ error: 'Bad Request', message: `The file must hold one of: ${this.runtimeSettings().map(([name]) => name).join(', ')}` });
      return;
    }
    if (sections.some(([, setting]) => !setting?.editable)) {
      res.status(503).json({ error: 'Service Unavailable', message: 'Changing these settings requires Redis or Admin.settingsFile' });
      return;
    }
    const invalid = sections.filter(([name, setting]) => setting?.parse(body[name]) === null).map(([name]) => name);
    if (invalid.length > 0) {
      res.status(400).json({ error: 'Bad Request', message: `Invalid sections, nothing was imported: ${invalid.join(', ')}` });
      return;
    }
    if (Object.hasOwn(body, 'stuffing') && this.lacksRecommendations(body.stuffing as Record<string, unknown>)) {
      res.status(400).json({ error: 'Bad Request', message: 'Recommended cards need Recommendation.enabled: nothing was imported' });
      return;
    }
    const imported: string[] = [];
    try {
      for (const [name, setting] of sections) {
        await setting?.save(body[name]);
        imported.push(name);
      }
      this.log.info(`Settings imported: ${imported.join(', ')}`);
      res.status(200).json({ imported });
    } catch (error) {
      this.log.error('Failed to import the settings:', error);
      res.status(503).json({ error: 'Service Unavailable', message: `The import stopped${imported.length ? ` after ${imported.join(', ')}` : ''}: the settings could not be saved` });
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

    const site = req.query.site;
    if (site !== undefined && site !== '' && (typeof site !== 'string' || !SITE_HOST.test(site))) {
      res.status(400).json({ error: 'Bad Request', message: 'site must be a host such as www.example.com' });
      return;
    }
    // The active site of the portal; every site together for older portals
    const host = site ? site as string : undefined;

    try {
      // Reports are kept per number of days ending today: a custom period gets as many days
      const days = AdminApi.dayCount(this.days(req));
      if (!generate) {
        res.status(200).json(await this.insights.latest(days, host) ?? { available: true, days, missing: true });
        return;
      }
      // The reports already written stay readable: only new, billed, ones are paused
      await this.tunables?.refresh();
      if (this.tunables && !this.tunables.effective.insights) {
        res.status(200).json({ available: false, reason: AdminApi.INSIGHTS_PAUSED });
        return;
      }
      res.status(200).json(await this.insights.report(days, host));
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

  /** Runs `handler` with the site of the query, after a 400 for a value that is not a host. */
  private withSite<T>(req: Request, res: Response, handler: (site: string | undefined) => Promise<T>): void {
    const site = req.query.site;
    if (site !== undefined && site !== '' && (typeof site !== 'string' || !SITE_HOST.test(site))) {
      res.status(400).json({ error: 'Bad Request', message: 'site must be a host such as www.example.com' });
      return;
    }
    this.withStats(res, () => handler(site ? site as string : undefined));
  }

  /** The sort order of a stats table, or undefined once a 400 has been sent for an invalid one. */
  private sort(req: Request, res: Response, fallback: PageSort): PageSort | undefined {
    const sort = req.query.sort ?? fallback;
    if (!PAGE_SORTS.includes(sort as PageSort)) {
      res.status(400).json({ error: 'Bad Request', message: `sort must be one of: ${PAGE_SORTS.join(', ')}` });
      return undefined;
    }
    return sort as PageSort;
  }

  /**
   * `from` and `to` (YYYY-MM-DD, UTC, both included) when both are valid, otherwise the last `days`
   * days. Days beyond the retention, or after today, have no statistics: the range is clamped.
   */
  private days(req: Request): Period {
    const { from, to } = req.query;
    if (typeof from === 'string' && typeof to === 'string' && AdminApi.isDate(from) && AdminApi.isDate(to) && from <= to) {
      const today = new Date().toISOString().slice(0, 10);
      const oldest = new Date(Date.now() - (Stats.RETENTION_DAYS - 1) * 86400000).toISOString().slice(0, 10);
      const start = from < oldest ? oldest : from;
      const end = to > today ? today : to;
      if (start <= end) return { from: start, to: end };
    }
    return AdminApi.boundedInt(req.query.days, AdminApi.DEFAULT_DAYS, Stats.RETENTION_DAYS);
  }

  private static dayCount(period: Period): number {
    return typeof period === 'number' ? period : Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86400000) + 1;
  }

  /** A real calendar date: 2026-02-30 is refused, as Date would roll it over. */
  private static isDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
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
