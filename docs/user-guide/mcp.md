# MCP for AI agents

AMW serves a [Model Context Protocol](https://modelcontextprotocol.io) endpoint, so that an AI agent
(Claude Code, Claude Desktop or your own agent) can read the figures of your sites and run A/B tests
to raise the click-through rate. The agent goes through the same rules as the
[administration portal](admin-portal.md): validation, one A/B test per site at a time, history and
logs.

AMW counts impressions and clicks, not sales: Amazon offers no API for the Associates reports. Give
your agent the sales from its own source if it should weigh them.

## Enabling it

The endpoint lives in the portal, at `<path>/admin/mcp` (`/item/admin/mcp` by default): it needs
`Admin.enabled` and its password, and it follows `Admin.allowedIps`.

1. Create a token of 32 characters at least, for example with `openssl rand -hex 32`.
2. Set `Admin.mcp: true` (or `AMW_ADMIN_MCP=true`) and `AMW_MCP_TOKEN` in the environment, then
   restart the server. It refuses to start with `Admin.mcp` and no token, or a shorter one.

The token is separate from the portal password: change `AMW_MCP_TOKEN` and restart to cut an agent
off without logging yourself out. The endpoint is stateless (Streamable HTTP, one JSON answer per
request) and shares the rate limit of the portal API.

## Connecting an agent

Claude Code:

```bash
claude mcp add --transport http amw https://amw.example.com/item/admin/mcp \
  --header "Authorization: Bearer $AMW_MCP_TOKEN"
```

Any client that speaks Streamable HTTP works the same way: the URL of the endpoint, and an
`Authorization: Bearer <token>` header.

## Tools

| Tool | Reads or changes |
|------|------------------|
| `list_sites` | The sites served, whose host is the `site` of the other tools. |
| `get_daily_stats` | Impressions, visits, clicks and product requests per day. |
| `get_top_pages` | Pages with their impressions, clicks and click-through rate. |
| `get_top_products` | Products with their impressions, clicks and click-through rate. |
| `get_products_not_found` | Products Amazon no longer returns, and the pages they hide a card on. |
| `get_ab_tests` | The theme, effect and button label of a site, the running test and the figures of each variant. |
| `get_ab_history` | The tests that ended, with what was kept and the results. |
| `get_stuffing` | The cards added to the articles, the custom products and the best deals searches. |
| `start_ab_test` | Starts a theme, effect or button label test, for 1 to 90 days or until stopped. |
| `stop_ab_test` | Stops a test and keeps one value for every visitor. |
| `set_custom_products` | Replaces the custom products of a site. |
| `set_deal_searches` | Replaces the best deals searches of a site. |

The figures take a period: `days` (the last 1 to 90 days) or `from` and `to` (YYYY-MM-DD). Out of
reach on purpose: the sites and their tracking IDs, the live settings, the backup and import of the
settings, the Amazon credentials, the paid AI insights and every call that uses the Amazon quota.

Every change the agent makes is logged (`MCP start_ab_test done: …`), and an A/B test it starts or
stops goes to the history of the [A/B tests view](admin-portal.md#effects) like one of yours.

## An optimisation loop

A prompt such as this one gives the agent a method rather than a target:

> Using the AMW tools, find the site and pages where the click-through rate is lowest for many
> impressions. If no A/B test runs on that site, start one for 14 days on the button label or the
> effect, with the current value as the control. When a test has ended, read its results: keep the
> winner only when the comparison is significant, otherwise keep the control. Report what you did.

The tools tell the agent the rules of a verdict (500 impressions and 10 clicks on both sides, and a
two-proportion test with a Bonferroni correction), so that it does not read a winner into a few days
of noise.
