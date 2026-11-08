/**
 * Restricts the administration portal to the addresses of Admin.allowedIps.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import net from "node:net";
// No import of Settings or Stats: Settings imports this module to validate the rules
import type { NextFunction, Request, Response } from "express";

type Family = 'ipv4' | 'ipv6';

interface IpRule {
  address: string;
  family: Family;
  prefix?: number;
}

/** An address or a CIDR range such as 192.0.2.10, 10.0.0.0/8 or 2001:db8::/32; null when invalid. */
function parseIpRule(rule: unknown): IpRule | null {
  if (typeof rule !== 'string') return null;
  const [address, prefixText, ...rest] = rule.trim().split('/');
  const version = net.isIP(address ?? '');
  if (rest.length > 0 || version === 0) return null;
  const family: Family = version === 4 ? 'ipv4' : 'ipv6';
  if (prefixText === undefined) return { address, family };
  const max = version === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > max) return null;
  return { address, family, prefix: Number(prefixText) };
}

/** IPv4 clients of a dual-stack socket show up as ::ffff:192.0.2.10 */
function normalize(ip: string): string {
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip) ? ip.slice(7) : ip;
}

/**
 * Whether `ip` may reach the portal; undefined when every address may (an empty list).
 * @throws On an invalid rule: Settings validates them first.
 */
function createIpMatcher(rules: string[]): ((ip: string | undefined) => boolean) | undefined {
  if (rules.length === 0) return undefined;
  const list = new net.BlockList();
  for (const rule of rules) {
    const parsed = parseIpRule(rule);
    if (!parsed) throw new Error(`Invalid IP address or range: ${rule}`);
    if (parsed.prefix === undefined) {
      list.addAddress(parsed.address, parsed.family);
    } else {
      list.addSubnet(parsed.address, parsed.prefix, parsed.family);
    }
  }
  return (ip: string | undefined): boolean => {
    if (!ip) return false;
    const address = normalize(ip);
    const version = net.isIP(address);
    return version !== 0 && list.check(address, version === 4 ? 'ipv4' : 'ipv6');
  };
}

/**
 * Answers 403 to other addresses, before the login and its rate limiter. Relies on req.ip, so on
 * Server.trustProxy: behind a proxy that is not trusted, every request has the proxy's address.
 */
function createIpFilter(rules: string[]) {
  const allowed = createIpMatcher(rules);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!allowed || allowed(req.ip)) {
      next();
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.status(403).json({ error: 'Forbidden', message: 'This address may not use the administration portal' });
  };
}

export { createIpFilter, createIpMatcher, parseIpRule };
