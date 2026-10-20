/**
 * OpenAPI description
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

// Kept as a TypeScript module rather than a YAML file so that tsc ships it in
// dist/ (and therefore in the npm package and Docker image) with no extra copy step,
// and so that the base path and limits come from the same values the server uses.

interface OpenApiOptions {
  basePath: string;
  version: string;
  rateLimit: number;
  httpCache: number;
  clickRateLimit?: number;
}

type OpenApiDocument = Record<string, unknown>;

const cacheHeaders = {
  'Cache-Control': { $ref: '#/components/headers/CacheControl' }
};

const widgetFileHeaders = (cacheControl: string) => ({
  'Cache-Control': { description: 'Set by the widget routes themselves.', schema: { type: 'string', example: cacheControl } }
});

// The limiter runs before the handler, so every /product response carries these headers
const rateLimitedHeaders = {
  ...cacheHeaders,
  RateLimit: { $ref: '#/components/headers/RateLimit' },
  'RateLimit-Policy': { $ref: '#/components/headers/RateLimitPolicy' }
};

const errorResponse = (
  description: string,
  example: { error: string; message: string },
  headers: Record<string, unknown> = cacheHeaders
) => ({
  description,
  headers,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
      example: { ...example, timestamp: '2026-01-01T12:00:00.000Z' }
    }
  }
});

const widgetNotFound = (fileName: string) => errorResponse('The file has not been built or no longer exists.', {
  error: 'Not Found',
  message: `${fileName} is not available`
}, widgetFileHeaders('no-store'));

/**
 * Build the OpenAPI 3.1 document of the AMW HTTP API.
 *
 * Paths are relative to a server URL equal to the configured base path, so
 * "Try it out" in Swagger UI can only target the origin serving the docs.
 */
function buildOpenApiSpec(options: OpenApiOptions): OpenApiDocument {
  const { basePath, version, rateLimit, httpCache, clickRateLimit = 60 } = options;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Amazon Modern Widgets (AMW) API',
      version,
      description:
        'Fetches Amazon products (through the Amazon Creators API, optionally cached in Redis) ' +
        'and serves the embeddable widget script.',
      license: { name: 'MIT', identifier: 'MIT' }
    },
    externalDocs: {
      description: 'Source code',
      url: 'https://github.com/ltoinel/amw'
    },
    servers: [
      { url: basePath, description: 'This server (configured Server.path)' }
    ],
    tags: [
      { name: 'Products', description: 'Amazon product lookup' },
      { name: 'Widget', description: 'Embeddable widget script and stylesheet' },
      { name: 'Statistics', description: 'Usage statistics collected for the administration portal' },
      { name: 'Monitoring', description: 'Health and server information' }
    ],
    paths: {
      '/product': {
        get: {
          tags: ['Products'],
          operationId: 'getProduct',
          summary: 'Get an Amazon product by ASIN or keyword',
          description:
            'At least one of `id` or `keyword` is required; when both are given, `id` wins. ' +
            'Control characters, `<`, `>`, `"` and `\'` are stripped and the value is trimmed; ' +
            'a value that is empty after sanitization is rejected with 400. ' +
            `Requests are rate limited to ${rateLimit} per minute and per client IP.`,
          parameters: [
            {
              name: 'id',
              in: 'query',
              required: false,
              description: 'Product ASIN.',
              schema: { type: 'string', minLength: 1, maxLength: 50 },
              example: 'B084DN3XVN'
            },
            {
              name: 'keyword',
              in: 'query',
              required: false,
              description: 'Search keywords; the first search result is returned.',
              schema: { type: 'string', minLength: 1, maxLength: 100 },
              example: 'arduino'
            }
          ],
          responses: {
            '200': {
              description: 'The product.',
              headers: rateLimitedHeaders,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Product' }
                }
              }
            },
            '400': errorResponse('Missing, malformed or too long `id` / `keyword` parameter.', {
              error: 'Validation Error',
              message: 'Missing required parameter: id or keyword'
            }, rateLimitedHeaders),
            '404': errorResponse('Amazon reports that no product matches the ASIN or keyword.', {
              error: 'Product Not Found',
              message: 'No product found for identifier: amw:product:id:B000000000'
            }, rateLimitedHeaders),
            '429': {
              description: 'Too many requests from this client IP in the current one-minute window.',
              headers: {
                ...rateLimitedHeaders,
                'Retry-After': {
                  description: 'Seconds until the rate limit window resets.',
                  schema: { type: 'integer', minimum: 0 }
                }
              },
              content: {
                // express-rate-limit sends its default plain message, not the JSON error shape
                'text/html': {
                  schema: { type: 'string' },
                  example: 'Too many requests, please try again later.'
                }
              }
            },
            '500': errorResponse('Unexpected error while fetching the product.', {
              error: 'Internal Server Error',
              message: 'An unexpected error occurred'
            }, rateLimitedHeaders),
            '502': errorResponse('The Amazon API call failed (authentication, Amazon server or network error).', {
              error: 'Bad Gateway',
              message: 'Amazon API returned an error'
            }, rateLimitedHeaders),
            '503': errorResponse('The Amazon API quota is exhausted (Amazon answered 429).', {
              error: 'Service Unavailable',
              message: 'Amazon API rate limit reached, retry later'
            }, {
              ...rateLimitedHeaders,
              'Retry-After': {
                description: 'Seconds to wait before retrying, as advised by Amazon (60 by default).',
                schema: { type: 'integer', minimum: 0 }
              }
            }),
            '504': errorResponse('The Amazon API did not answer in time.', {
              error: 'Gateway Timeout',
              message: 'Request timed out while fetching product data'
            }, rateLimitedHeaders)
          }
        }
      },
      '/click': {
        post: {
          tags: ['Statistics'],
          operationId: 'recordClick',
          summary: 'Record a click on a widget affiliate link',
          description:
            'Beacon sent by the widget with `navigator.sendBeacon` when its product link is followed. ' +
            'It has no body and no custom header, so browsers send it without a CORS preflight. ' +
            'Only aggregated daily counters are stored (and only when Redis is enabled): no IP address, ' +
            'user agent or cookie. ' +
            `Requests are rate limited to ${clickRateLimit} per minute and per client IP.`,
          parameters: [
            {
              name: 'id',
              in: 'query',
              required: true,
              description: 'Product ASIN.',
              schema: { type: 'string', pattern: '^[A-Z0-9]{10}$' },
              example: 'B084DN3XVN'
            }
          ],
          responses: {
            '204': {
              description: 'Click recorded (or ignored when statistics are disabled).',
              headers: {
                'Cache-Control': {
                  description: 'Always `no-store`.',
                  schema: { type: 'string', const: 'no-store' }
                }
              }
            },
            '400': errorResponse('Missing or invalid ASIN.', {
              error: 'Validation Error',
              message: 'Parameter id must be an ASIN'
            }),
            '429': {
              description: 'Too many clicks from this client IP in the current one-minute window.',
              content: {
                'text/html': {
                  schema: { type: 'string' },
                  example: 'Too many requests, please try again later.'
                }
              }
            }
          }
        }
      },
      '/widget.js': {
        get: {
          tags: ['Widget'],
          operationId: 'getWidget',
          summary: 'Get the embeddable widget script',
          responses: {
            '200': {
              description: 'Minified widget JavaScript. Short-lived so that integrations pick up new releases.',
              headers: widgetFileHeaders('public, max-age=3600'),
              content: {
                'application/javascript': { schema: { type: 'string' } }
              }
            },
            '404': widgetNotFound('widget.js'),
            '500': errorResponse('The widget file could not be served.', {
              error: 'Internal Server Error',
              message: 'An unexpected error occurred'
            }, widgetFileHeaders('no-store'))
          }
        }
      },
      '/widget.css': {
        get: {
          tags: ['Widget'],
          operationId: 'getWidgetCss',
          summary: 'Get the widget stylesheet (loaded by widget.js)',
          responses: {
            '200': {
              description: 'Minified widget CSS. Short-lived so that integrations pick up new releases.',
              headers: widgetFileHeaders('public, max-age=3600'),
              content: {
                'text/css': { schema: { type: 'string' } }
              }
            },
            '404': widgetNotFound('widget.css'),
            '500': errorResponse('The widget file could not be served.', {
              error: 'Internal Server Error',
              message: 'An unexpected error occurred'
            }, widgetFileHeaders('no-store'))
          }
        }
      },
      '/widget.{hash}.{ext}': {
        get: {
          tags: ['Widget'],
          operationId: 'getVersionedWidgetFile',
          summary: 'Get a content-hashed copy of widget.js or widget.css, cacheable forever',
          parameters: [
            { name: 'hash', in: 'path', required: true, schema: { type: 'string', pattern: '^[0-9a-f]{10}$' } },
            { name: 'ext', in: 'path', required: true, schema: { type: 'string', enum: ['js', 'css'] } }
          ],
          responses: {
            '200': {
              description: 'Minified widget file; its name changes whenever its content does.',
              headers: widgetFileHeaders('public, max-age=31536000, immutable'),
              content: {
                'application/javascript': { schema: { type: 'string' } },
                'text/css': { schema: { type: 'string' } }
              }
            },
            '404': widgetNotFound('widget.0123456789.js')
          }
        }
      },
      '/widget-manifest.json': {
        get: {
          tags: ['Widget'],
          operationId: 'getWidgetManifest',
          summary: 'Get the current hashed names of the widget files',
          responses: {
            '200': {
              description: 'Maps the stable file names to their content-hashed copies.',
              headers: widgetFileHeaders('public, max-age=3600'),
              content: {
                'application/json': {
                  schema: { type: 'object', additionalProperties: { type: 'string' } },
                  example: { 'widget.css': 'widget.495589d8a2.css', 'widget.js': 'widget.804de894f8.js' }
                }
              }
            },
            '404': widgetNotFound('manifest.json')
          }
        }
      },
      '/health': {
        get: {
          tags: ['Monitoring'],
          operationId: 'getHealth',
          summary: 'Health check',
          responses: {
            '200': {
              description: 'The server is up.',
              headers: cacheHeaders,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' }
                }
              }
            }
          }
        }
      },
      '/info': {
        get: {
          tags: ['Monitoring'],
          operationId: 'getInfo',
          summary: 'Server information',
          responses: {
            '200': {
              description: 'Name, version and exposed endpoints.',
              headers: cacheHeaders,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Info' }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        Product: {
          type: 'object',
          required: ['image', 'title', 'url', 'brand', 'asin', 'price', 'timestamp', 'savings'],
          properties: {
            image: { type: 'string', format: 'uri', description: 'Large primary image URL.' },
            title: { type: 'string' },
            url: { type: 'string', format: 'uri', description: 'Product detail page URL (with the partner tag).' },
            brand: { type: 'string', description: 'Empty string when unknown.' },
            asin: { type: 'string', description: 'Empty string when unknown.' },
            price: {
              oneOf: [
                { type: 'string', description: 'Formatted price of the first offer, e.g. "24,99 €".' },
                { type: 'integer', const: -1, description: 'No offer available.' }
              ]
            },
            savings: {
              type: 'number',
              minimum: 0,
              description: 'Discount percentage of the first offer, 0 when none.'
            },
            timestamp: {
              type: 'integer',
              description: 'Time the product was fetched from Amazon (Unix epoch, milliseconds); older than the request when served from the Redis cache.'
            }
          },
          example: {
            image: 'https://m.media-amazon.com/images/I/71example.jpg',
            title: 'Arduino Uno R3',
            url: 'https://www.amazon.fr/dp/B084DN3XVN?tag=partner-21',
            brand: 'Arduino',
            asin: 'B084DN3XVN',
            price: '24,99 €',
            savings: 15,
            timestamp: 1767268800000
          }
        },
        Error: {
          type: 'object',
          required: ['error', 'message', 'timestamp'],
          properties: {
            error: { type: 'string', description: 'Short error category.' },
            message: { type: 'string', description: 'Human readable details.' },
            timestamp: { type: 'string', format: 'date-time' }
          }
        },
        Health: {
          type: 'object',
          required: ['status', 'version', 'timestamp', 'uptime', 'redis'],
          properties: {
            status: { type: 'string', const: 'ok' },
            version: { type: 'string', example: version },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number', description: 'Process uptime in seconds.' },
            redis: { type: 'string', enum: ['connected', 'disconnected', 'disabled'] }
          }
        },
        Info: {
          type: 'object',
          required: ['name', 'version', 'author', 'source', 'endpoints'],
          properties: {
            name: { type: 'string', example: 'Amazon Modern Widgets (AMW)' },
            version: { type: 'string', example: version },
            author: { type: 'string' },
            source: { type: 'string', format: 'uri' },
            endpoints: {
              type: 'array',
              items: { type: 'string' },
              example: [`${basePath}/product`, `${basePath}/click`, `${basePath}/widget.js`, `${basePath}/health`, `${basePath}/info`]
            }
          }
        }
      },
      headers: {
        CacheControl: {
          description: 'Set on every response from the Server.httpCache setting.',
          schema: { type: 'string' },
          example: `max-age=${httpCache}`
        },
        RateLimit: {
          description: 'Remaining quota and seconds until reset (IETF draft-ietf-httpapi-ratelimit-headers-08).',
          schema: { type: 'string' },
          example: `"${rateLimit}-in-1min"; r=${rateLimit - 1}; t=60`
        },
        RateLimitPolicy: {
          description: 'Quota policy (IETF draft-ietf-httpapi-ratelimit-headers-08).',
          schema: { type: 'string' },
          example: `"${rateLimit}-in-1min"; q=${rateLimit}; w=60; pk=:cmVhbGx5IGxvbmcgc2hhMjU2:`
        }
      }
    }
  };
}

export { buildOpenApiSpec, OpenApiDocument, OpenApiOptions };
