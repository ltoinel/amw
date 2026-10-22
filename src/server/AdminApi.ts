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
import { Stats, noStore } from "./Stats";
import type { Settings } from "./Settings";

interface AdminOptions {
  password: string;
  // Tokens signed with a random secret are lost on restart, which only forces a new login
  secret?: string;
  tokenTtl?: number;
  loginRateLimit?: number;
  // Directory of the built portal (dist/admin); the API alone is served without it
  staticDir?: string;
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
  private static readonly KEY_LENGTH: number = 32;
  // Authenticated calls per minute and per IP: the portal makes 5 per refresh
  private static readonly API_RATE_LIMIT: number = 120;
  private static readonly scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
  private static readonly STATS_UNAVAILABLE: string = 'Statistics require Redis';
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
  public static fromSettings(stats: Stats, settings: Settings, env: NodeJS.ProcessEnv = process.env): AdminApi | undefined {
    if (!settings.admin.enabled) {
      return undefined;
    }

    return new AdminApi(stats, {
      password: env.AMW_ADMIN_PASSWORD || '',
      secret: env.AMW_ADMIN_SECRET,
      tokenTtl: settings.admin.tokenTtl,
      loginRateLimit: settings.admin.loginRateLimit,
      staticDir: path.join(settings.server.projectDir, 'dist', 'admin')
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
        retentionDays: Stats.RETENTION_DAYS
      });
    });

    router.get('/api/stats/daily', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getDaily(this.days(req)));
    });

    router.get('/api/stats/products', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getTopProducts(this.days(req), this.limit(req)));
    });

    router.get('/api/stats/pages', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getTopPages(this.days(req), this.limit(req)));
    });

    router.get('/api/stats/notfound', (req: Request, res: Response) => {
      this.withStats(res, () => this.stats.getNotFound(this.limit(req)));
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
