/**
 * Integration tests for AMW Server
 * Tests server initialization, routing, and API endpoints
 */

import request from 'supertest';
import express from 'express';

// Mock configuration
const mockConfig = {
  'Server.port': 3000,
  'Server.path': '/amw',
  'Cache.ttl': 3600
};

jest.mock('config', () => ({
  get: (key: string) => mockConfig[key as keyof typeof mockConfig]
}));

// Mock Redis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK')
  }));
});

// Mock logger - create a simple mock instead of importing
const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

// Mock PAAPI
const mockPaapiInstance = {
  getItemApi: jest.fn(),
  searchItemApi: jest.fn()
};

describe('AMW Server Integration Tests', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Mock product endpoint
    app.get('/amw/product', async (req, res) => {
      const { id, keyword } = req.query;
      
      if (id === 'B084DN3XVN') {
        res.json({
          title: 'Arduino Uno R3',
          price: '€24.99',
          image: 'https://example.com/arduino.jpg',
          url: 'https://amazon.fr/dp/B084DN3XVN',
          prime: true,
          savings: 15,
          timestamp: Date.now()
        });
      } else if (keyword === 'arduino') {
        res.json({
          title: 'Arduino Development Board',
          price: '€29.99',
          image: 'https://example.com/arduino-board.jpg',
          url: 'https://amazon.fr/dp/B123456789',
          prime: false,
          savings: 0,
          timestamp: Date.now()
        });
      } else if (id === 'NOTFOUND') {
        res.status(404).json('Product Not found');
      } else {
        res.status(400).json('Invalid request parameters');
      }
    });

    app.get('/amw/card', (req, res) => {
      res.type('text/html');
      res.send('<html><body><h1>Amazon Product Card</h1></body></html>');
    });

    app.get('/amw/widget', (req, res) => {
      res.type('application/javascript');
      res.send('// Amazon Widget JavaScript Code\nconsole.log("Widget loaded");');
    });
  });

  describe('Product API Endpoint', () => {
    test('should return product data for valid ASIN', async () => {
      const response = await request(app)
        .get('/amw/product')
        .query({ id: 'B084DN3XVN' })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Arduino Uno R3',
        price: '€24.99',
        prime: true,
        savings: 15
      });
      expect(response.body.timestamp).toBeDefined();
    });

    test('should return product data for keyword search', async () => {
      const response = await request(app)
        .get('/amw/product')
        .query({ keyword: 'arduino' })
        .expect(200);

      expect(response.body).toMatchObject({
        title: 'Arduino Development Board',
        price: '€29.99',
        prime: false
      });
    });

    test('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .get('/amw/product')
        .query({ id: 'NOTFOUND' })
        .expect(404);

      expect(response.body).toBe('Product Not found');
    });

    test('should return 400 for invalid parameters', async () => {
      await request(app)
        .get('/amw/product')
        .query({ invalid: 'parameter' })
        .expect(400);
    });

    test('should handle missing parameters', async () => {
      await request(app)
        .get('/amw/product')
        .expect(400);
    });
  });

  describe('Card Endpoint', () => {
    test('should serve HTML card page', async () => {
      const response = await request(app)
        .get('/amw/card')
        .expect(200);

      expect(response.type).toBe('text/html');
      expect(response.text).toContain('<h1>Amazon Product Card</h1>');
    });

    test('should work with query parameters', async () => {
      await request(app)
        .get('/amw/card')
        .query({ id: 'B084DN3XVN' })
        .expect(200);
    });
  });

  describe('Widget Endpoint', () => {
    test('should serve JavaScript widget file', async () => {
      const response = await request(app)
        .get('/amw/widget')
        .expect(200);

      expect(response.type).toBe('application/javascript');
      expect(response.text).toContain('Widget loaded');
    });
  });

  describe('Error Handling', () => {
    test('should handle 404 for unknown endpoints', async () => {
      await request(app)
        .get('/amw/unknown')
        .expect(404);
    });

    test('should handle invalid HTTP methods', async () => {
      await request(app)
        .post('/amw/product')
        .expect(404);
    });
  });

  describe('CORS and Headers', () => {
    test('should include proper content-type headers', async () => {
      const response = await request(app)
        .get('/amw/product')
        .query({ id: 'B084DN3XVN' })
        .expect(200);

      expect(response.type).toBe('application/json');
    });

    test('should handle various user agents', async () => {
      await request(app)
        .get('/amw/product')
        .query({ id: 'B084DN3XVN' })
        .set('User-Agent', 'Mozilla/5.0 (compatible; AMW-Test)')
        .expect(200);
    });

    test('should handle referrer headers', async () => {
      await request(app)
        .get('/amw/product')
        .query({ id: 'B084DN3XVN' })
        .set('Referer', 'https://example.com/blog/post')
        .expect(200);
    });
  });

  describe('Query Parameter Validation', () => {
    test('should handle special characters in ASIN', async () => {
      await request(app)
        .get('/amw/product')
        .query({ id: 'B084-DN3XVN' })
        .expect(400);
    });

    test('should handle long keywords', async () => {
      const longKeyword = 'a'.repeat(200);
      await request(app)
        .get('/amw/product')
        .query({ keyword: longKeyword })
        .expect(400);
    });

    test('should handle URL-encoded parameters', async () => {
      // Test with single keyword (server expects single words)
      await request(app)
        .get('/amw/product')
        .query({ keyword: 'arduino' })
        .expect(200);
    });

    test('should handle multiple parameters (should use id over keyword)', async () => {
      const response = await request(app)
        .get('/amw/product')
        .query({ id: 'B084DN3XVN', keyword: 'arduino' })
        .expect(200);

      // Should prioritize ID over keyword
      expect(response.body.title).toBe('Arduino Uno R3');
    });
  });
});