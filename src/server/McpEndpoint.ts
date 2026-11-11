/**
 * MCP endpoint
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * Model Context Protocol tools for AI agents, at <path>/admin/mcp: the agent reads the
 * statistics and the A/B tests, and runs tests or changes the cards of Stuffing to raise the
 * click-through rate. Each tool runs a handler of the admin portal, so the agent follows the
 * same rules (validation, one test at a time, history, logs). Sites, tracking IDs, tunables,
 * Amazon credentials, paid AI calls and calls using the Amazon quota stay out of reach.
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import crypto from "crypto";
import { z } from "zod";
import type { NextFunction, Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getLogger, Logger } from "../utils/logger";
import { BUTTON_LABELS, MAX_DEAL_PRODUCTS, MAX_DEAL_SAVING, MAX_DEAL_SEARCHES, MAX_STUFFING_PRODUCTS, MIN_DEAL_SAVING, SITE_HOST, WIDGET_EFFECTS, WIDGET_THEMES } from "./Settings";
import { PAGE_SORTS } from "./Stats";
import { ASIN_PATTERN } from "./Schemas";
import type { AgentAction, AgentResult } from "./AdminApi";

/** What the endpoint needs of the admin API. */
interface AgentApi {
  call(action: AgentAction, query?: Record<string, string | undefined>, body?: unknown): Promise<AgentResult>;
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const KINDS = ['theme', 'effect', 'label'] as const;
type Kind = typeof KINDS[number];

// The A/B rules of the portal, so that the agent does not read a winner into a small sample
const AB_RULES = 'A variant beats the control only with 500 impressions and 10 clicks on both sides and a two-proportion z-test past 1.96 for two variants (2.77 for ten, a Bonferroni correction). Below that, the gap is noise: wait, do not conclude.';
const METRICS = 'Impressions: product cards displayed, counted once per product, page and browser tab session (no cookie). Visits: first impressions of a page in a tab session. CTR: clicks / impressions. Sales are not tracked by AMW.';

const site = z.string().regex(SITE_HOST).optional()
  .describe('Host of a site of the Sites list, such as www.example.com. Omit for every site.');
const period = {
  days: z.number().int().min(1).max(90).optional().describe('The last N days, up to today (default 30, at most 90).'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('First day (YYYY-MM-DD, UTC), with to.'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Last day (YYYY-MM-DD, UTC), with from.'),
};
const limit = z.number().int().min(1).max(500).optional().describe('Rows to return (default 50).');

class McpEndpoint {
  private readonly log: Logger = getLogger('McpEndpoint');
  // Compared as digests: equal lengths for timingSafeEqual, whatever the token sent
  private readonly tokenDigest: Buffer;

  constructor(private readonly api: AgentApi, token: string) {
    this.tokenDigest = McpEndpoint.digest(token);
  }

  public authenticate(req: Request, res: Response, next: NextFunction): void {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !crypto.timingSafeEqual(McpEndpoint.digest(token), this.tokenDigest)) {
      res.status(401).set('WWW-Authenticate', 'Bearer').json({ jsonrpc: '2.0', error: { code: -32001, message: 'Missing or invalid token' }, id: null });
      return;
    }
    next();
  }

  /** Stateless: a server and a transport per request, nothing kept between two calls. */
  public async handle(req: Request, res: Response): Promise<void> {
    const server = this.server();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.log.error('MCP request failed:', error);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
    }
  }

  private server(): McpServer {
    const server = new McpServer(
      { name: 'amw', version: '1.0.0' },
      { instructions: `Amazon Modern Widgets shows Amazon affiliate product cards on the owner's sites. Use these tools to find what raises the click-through rate and test it. ${METRICS} ${AB_RULES} Run one A/B test per site at a time, give it a duration (14 days is a good default), and decide at its end rather than every day.` }
    );
    const read = { readOnlyHint: true, openWorldHint: false };
    const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

    server.registerTool('list_sites', {
      title: 'List the sites',
      description: 'The sites served by AMW, with their description and URL. Use their host as the site of the other tools.',
      annotations: read
    }, () => this.run('list_sites', 'sites'));

    server.registerTool('get_daily_stats', {
      title: 'Daily statistics',
      description: `Impressions, visits, clicks and product requests per day over a period. ${METRICS}`,
      inputSchema: { site, ...period },
      annotations: read
    }, args => this.run('get_daily_stats', 'daily', McpEndpoint.query(args)));

    server.registerTool('get_top_pages', {
      title: 'Top pages',
      description: 'The pages embedding the cards, with their impressions, clicks and CTR, ranked by the sort column. Pages with many impressions and a low CTR are the first to improve.',
      inputSchema: { site, ...period, sort: z.enum(PAGE_SORTS).optional().describe('Ranking column (default clicks).'), limit },
      annotations: read
    }, args => this.run('get_top_pages', 'pages', McpEndpoint.query(args)));

    server.registerTool('get_top_products', {
      title: 'Top products',
      description: 'The products shown in the cards, with their impressions, clicks and CTR, ranked by the sort column.',
      inputSchema: { site, ...period, sort: z.enum(PAGE_SORTS).optional().describe('Ranking column (default impressions).'), limit },
      annotations: read
    }, args => this.run('get_top_products', 'products', McpEndpoint.query(args)));

    server.registerTool('get_products_not_found', {
      title: 'Products to replace',
      description: 'Products Amazon no longer returns: their cards stay hidden on the listed pages. Replace them in the pages or in the custom products.',
      inputSchema: { site, ...period, limit },
      annotations: read
    }, args => this.run('get_products_not_found', 'notFound', McpEndpoint.query(args)));

    server.registerTool('get_ab_tests', {
      title: 'A/B tests',
      description: `The theme, effect and button label settings of a site, which of them runs an A/B test (mode "compare", with startedAt and endsAt), and the impressions, clicks and CTR of each variant over the period, with their daily figures. ${AB_RULES}`,
      inputSchema: { site, ...period },
      annotations: read
    }, async args => this.guard('get_ab_tests', async () => {
      const query = McpEndpoint.query(args);
      const settingQuery = { site: query.site };
      const [theme, effect, label, themes, effects, labels] = await Promise.all([
        this.api.call('themeTest', settingQuery), this.api.call('effect', settingQuery), this.api.call('buttonLabel', settingQuery),
        this.api.call('themeStats', query), this.api.call('effectStats', query), this.api.call('labelStats', query)
      ]);
      const failed = [theme, effect, label].find(result => result.status !== 200);
      if (failed) return McpEndpoint.answer(failed);
      const stats = (result: AgentResult) => (result.status === 200 ? result.body : null);
      return McpEndpoint.text({
        theme: { setting: theme.body, results: stats(themes) },
        effect: { setting: effect.body, results: stats(effects) },
        label: { setting: label.body, results: stats(labels) },
        ...(themes.status !== 200 ? { statistics: 'unavailable: they need Redis' } : {})
      });
    }));

    server.registerTool('get_ab_history', {
      title: 'Past A/B tests',
      description: 'The A/B tests that ended on a site, newest first: variants, control, dates, why they ended (kept, stopped, expired), the value kept and the results of each variant.',
      inputSchema: { site },
      annotations: read
    }, args => this.run('get_ab_history', 'abHistory', McpEndpoint.query(args)));

    server.registerTool('get_stuffing', {
      title: 'Cards added to articles',
      description: 'Stuffing settings: whether cards are added to the articles, how many, from which source (recommendation, popular, manual custom products, deals, mix), the custom products and the best deals searches.',
      inputSchema: { site },
      annotations: read
    }, args => this.run('get_stuffing', 'stuffing', McpEndpoint.query(args)));

    server.registerTool('start_ab_test', {
      title: 'Start an A/B test',
      description: `Starts an A/B test on a site: each browser tab session gets one of the variants, and the impressions and clicks are counted per variant. Only one test may run per site, and its kind of setting is locked while it runs. Themes: ${WIDGET_THEMES.join(', ')}. Effects: ${WIDGET_EFFECTS.join(', ')} (none is the control). Button labels: ${BUTTON_LABELS.join(', ')}. ${AB_RULES}`,
      inputSchema: {
        site,
        kind: z.enum(KINDS).describe('What the variants change: the card theme, the appearance effect or the button label.'),
        variants: z.array(z.string()).min(2).max(10).describe('The values compared, the current one included as the control.'),
        days: z.number().int().min(1).max(90).optional().describe('Planned duration: the test stops by itself and goes back to the control. Omit to run until stopped.')
      },
      annotations: write
    }, args => this.guard('start_ab_test', async () => {
      const query = { site: args.site };
      const current = await this.api.call(McpEndpoint.reader(args.kind), query);
      if (current.status !== 200) return McpEndpoint.answer(current);
      const value = current.body as { theme?: string; label?: string };
      const days = args.days ? { days: args.days } : {};
      const body = args.kind === 'theme' ? { mode: 'compare', themes: args.variants, ...(value.theme ? { theme: value.theme } : {}), ...days }
        : args.kind === 'effect' ? { mode: 'compare', effects: args.variants, ...days }
          : { label: value.label ?? 'offer', mode: 'compare', labels: args.variants, ...days };
      return McpEndpoint.answer(await this.api.call(McpEndpoint.writer(args.kind), query, body));
    }, args));

    server.registerTool('stop_ab_test', {
      title: 'Stop an A/B test',
      description: 'Stops the running A/B test of a kind on a site and keeps one value for every visitor: the winner, or the control when no variant won. The test goes to the history.',
      inputSchema: {
        site,
        kind: z.enum(KINDS),
        keep: z.string().describe('The value every visitor gets from now on.')
      },
      annotations: write
    }, args => this.guard('stop_ab_test', async () => {
      const query = { site: args.site };
      const body = args.kind === 'theme' ? { mode: 'off', themes: [], theme: args.keep }
        : args.kind === 'effect' ? { mode: args.keep, effects: [...WIDGET_EFFECTS] }
          : { label: args.keep, mode: 'off', labels: [] };
      return McpEndpoint.answer(await this.api.call(McpEndpoint.writer(args.kind), query, body));
    }, args));

    server.registerTool('set_custom_products', {
      title: 'Set the custom products',
      description: `Replaces the custom products of a site (${MAX_STUFFING_PRODUCTS} ASINs at most, in order): the cards of the manual source show them, the first card the first product. Read get_stuffing first, and keep the banners you do not mean to remove.`,
      inputSchema: {
        site,
        products: z.array(z.string()).max(MAX_STUFFING_PRODUCTS).describe(`ASINs (10 capital letters or digits, ${ASIN_PATTERN.source}) or banner:<id> for a banner of the site.`)
      },
      annotations: { ...write, destructiveHint: true }
    }, args => this.guard('set_custom_products', async () =>
      McpEndpoint.answer(await this.api.call('saveStuffingProducts', { site: args.site }, { products: args.products })), args));

    server.registerTool('set_deal_searches', {
      title: 'Set the best deals searches',
      description: `Replaces the Amazon searches of the best deals cards of a site (${MAX_DEAL_SEARCHES} at most). Each search reads Amazon once every 3 hours and keeps its most discounted products.`,
      inputSchema: {
        site,
        searches: z.array(z.object({
          keywords: z.string().min(1).describe('Words searched on Amazon.'),
          searchIndex: z.string().optional().describe('Amazon category, such as ToysAndGames (default All).'),
          minSavingPercent: z.number().int().min(MIN_DEAL_SAVING).max(MAX_DEAL_SAVING).optional().describe('Smallest discount kept, in percent (default 20).'),
          maxProducts: z.number().int().min(1).max(MAX_DEAL_PRODUCTS).optional().describe(`Products kept from this search (default ${MAX_DEAL_PRODUCTS}).`)
        })).max(MAX_DEAL_SEARCHES)
      },
      annotations: { ...write, destructiveHint: true }
    }, args => this.guard('set_deal_searches', async () =>
      // The defaults of a new search in the portal
      McpEndpoint.answer(await this.api.call('saveDealSearches', { site: args.site }, {
        searches: args.searches.map(search => ({ searchIndex: 'All', minSavingPercent: 20, maxProducts: MAX_DEAL_PRODUCTS, ...search }))
      })), args));

    return server;
  }

  /** A read tool: one handler, its answer as is. */
  private run(tool: string, action: AgentAction, query: Record<string, string | undefined> = {}): Promise<ToolResult> {
    return this.guard(tool, async () => McpEndpoint.answer(await this.api.call(action, query)));
  }

  /** Logs the changes, and turns a failure into a tool error the agent can read. */
  private async guard(tool: string, work: () => Promise<ToolResult>, args?: unknown): Promise<ToolResult> {
    try {
      const result = await work();
      if (args !== undefined) {
        this.log.info(`MCP ${tool} ${result.isError ? 'refused' : 'done'}: ${JSON.stringify(args).slice(0, 500)}`);
      }
      return result;
    } catch (error) {
      this.log.error(`MCP ${tool} failed:`, error);
      return { content: [{ type: 'text', text: 'The tool failed on the server; try again later.' }], isError: true };
    }
  }

  private static reader(kind: Kind): AgentAction {
    return kind === 'theme' ? 'themeTest' : kind === 'effect' ? 'effect' : 'buttonLabel';
  }

  private static writer(kind: Kind): AgentAction {
    return kind === 'theme' ? 'saveThemeTest' : kind === 'effect' ? 'saveEffect' : 'saveButtonLabel';
  }

  /** The query string of the portal from the arguments of a tool. */
  private static query(args: Record<string, unknown>): Record<string, string | undefined> {
    return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, value === undefined ? undefined : String(value)]));
  }

  /** The body of a handler, an error for the agent when it refused. */
  private static answer(result: AgentResult): ToolResult {
    if (result.status >= 400) {
      const message = (result.body as { message?: string } | null)?.message ?? `HTTP ${result.status}`;
      return { content: [{ type: 'text', text: `Refused (${result.status}): ${message}` }], isError: true };
    }
    return McpEndpoint.text(result.body);
  }

  private static text(value: unknown): ToolResult {
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }

  private static digest(token: string): Buffer {
    return crypto.createHash('sha256').update(token, 'utf8').digest();
  }
}

export { McpEndpoint };
export type { AgentApi };
