/**
 * Structured logging (pino) and HTTP request logging (pino-http).
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { IncomingMessage, ServerResponse } from "http";
import { Request, RequestHandler } from "express";
import config from "config";
import pino, { LoggerOptions } from "pino";
import { pinoHttp } from "pino-http";

export const REQUEST_ID_HEADER = "X-Request-Id";

// Incoming ids are echoed in a response header and in every log line: accept only short tokens
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// Credentials must never reach log storage, whichever object they are attached to
const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["proxy-authorization"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  "*.authorization",
  "*.Authorization",
  "*.credentialId",
  "*.credentialSecret",
  "*.password",
  "*.accessToken",
  "*.access_token",
  "*.clientSecret",
  "*.client_secret",
];

const requestContext = new AsyncLocalStorage<{ reqId: string }>();

/**
 * @param debug Server.debug: environment variables arrive as strings, hence the 'true' comparison.
 * @param nodeEnv Human-readable output only in development, where pino-pretty is installed;
 * every other environment writes one JSON object per line for log collectors.
 */
export function buildLoggerOptions(debug: unknown, nodeEnv: string | undefined, prettyAvailable: boolean): LoggerOptions {
  const options: LoggerOptions = {
    level: debug === true || debug === "true" ? "debug" : "info",
    redact: { paths: REDACTED_PATHS, censor: "[REDACTED]" },
    // Lines written while serving a request carry its id, without threading it through every call
    mixin: () => {
      const context = requestContext.getStore();
      return context ? { reqId: context.reqId } : {};
    },
  };
  if (nodeEnv === "development" && prettyAvailable) {
    options.transport = {
      target: "pino-pretty",
      options: { translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l", ignore: "pid,hostname,module", messageFormat: "[{module}] {msg}" },
    };
  }
  return options;
}

/** pino-pretty is a dev dependency: absent from the production image even if NODE_ENV says development. */
export function isPrettyAvailable(): boolean {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

const rootLogger = pino(buildLoggerOptions(config.get("Server.debug"), process.env.NODE_ENV, isPrettyAvailable()));

/**
 * Keeps the `log.level(message, error?)` call style of the previous logger, so call sites are unchanged;
 * the optional second argument is logged under `err` (pino serializes the stack of Error instances).
 */
export class Logger {
  constructor(private readonly target: pino.Logger) {}

  public debug(message: string, error?: unknown): void {
    this.write("debug", message, error);
  }

  public info(message: string, error?: unknown): void {
    this.write("info", message, error);
  }

  public warn(message: string, error?: unknown): void {
    this.write("warn", message, error);
  }

  public error(message: string, error?: unknown): void {
    this.write("error", message, error);
  }

  private write(level: "debug" | "info" | "warn" | "error", message: string, error?: unknown): void {
    if (error === undefined) {
      this.target[level](message);
    } else {
      this.target[level]({ err: error }, message);
    }
  }
}

export function getLogger(name: string, base: pino.Logger = rootLogger): Logger {
  return new Logger(base.child({ module: name }));
}

/**
 * Honours a well-formed X-Request-Id set by a proxy (to correlate its logs with ours), otherwise
 * generates one, and returns it to the client in the response.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER.toLowerCase()];
  const id = typeof incoming === "string" && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * One log line per completed request, at a level matching the status code.
 * @param ignorePaths Exact paths not logged, e.g. the health check polled by Docker every few seconds.
 */
export function createRequestLogger(ignorePaths: string[] = [], base: pino.Logger = rootLogger): RequestHandler[] {
  const httpLogger = pinoHttp({
    logger: base.child({ module: "http" }),
    genReqId: resolveRequestId,
    // req.ip honours Server.trustProxy, unlike the socket address pino-http logs by default
    customProps: (req) => ({ clientIp: (req as Request).ip }),
    autoLogging: { ignore: (req) => ignorePaths.includes((req.url || "").split("?")[0]) },
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
  });

  const bindRequestContext: RequestHandler = (req, _res, next) => {
    requestContext.run({ reqId: String(req.id) }, next);
  };

  return [httpLogger, bindRequestContext];
}
