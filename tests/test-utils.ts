/**
 * Test runner and setup utilities
 * Provides common test utilities and setup functions
 */

// Test utilities for AMW project
export class TestUtils {
  
  /**
   * Create a mock Amazon product response
   */
  static createMockAmazonProduct(overrides: Partial<any> = {}) {
    return {
      ASIN: 'B084DN3XVN',
      Images: {
        Primary: {
          Large: {
            URL: 'https://m.media-amazon.com/images/I/71ABC123DEF.jpg'
          }
        }
      },
      ItemInfo: {
        Title: {
          DisplayValue: 'Arduino Uno R3 - Microcontroller Board'
        }
      },
      DetailPageURL: 'https://www.amazon.fr/dp/B084DN3XVN',
      Offers: {
        Listings: [{
          Price: {
            DisplayAmount: '€24.99',
            Savings: {
              Percentage: 15
            }
          },
          DeliveryInfo: {
            IsPrimeEligible: true
          }
        }]
      },
      ...overrides
    };
  }

  /**
   * Create a mock Express request object
   */
  static createMockRequest(options: any = {}) {
    return {
      query: options.query || {},
      params: options.params || {},
      headers: options.headers || { 'x-forwarded-for': '192.168.1.1' },
      ip: options.ip || '127.0.0.1',
      get: jest.fn().mockReturnValue(options.referer || 'http://example.com'),
      ...options
    };
  }

  /**
   * Create a mock Express response object
   */
  static createMockResponse() {
    const res: any = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      sendFile: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis()
    };
    return res;
  }

  /**
   * Create a mock logger
   */
  static createMockLogger() {
    return {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };
  }

  /**
   * Create a mock Redis cache
   */
  static createMockRedisCache() {
    return {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn()
    };
  }

  /**
   * Wait for a specified amount of time (for testing async operations)
   */
  static async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Generate a random ASIN for testing
   */
  static generateRandomASIN(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'B';
    for (let i = 0; i < 9; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Validate test environment
   */
  static validateTestEnvironment() {
    const requiredGlobals = ['describe', 'test', 'expect', 'jest', 'beforeEach', 'afterEach'];
    const missing = requiredGlobals.filter(global => typeof (globalThis as any)[global] === 'undefined');
    
    if (missing.length > 0) {
      throw new Error(`Missing test globals: ${missing.join(', ')}`);
    }
    
    return true;
  }

  /**
   * Setup common test mocks
   */
  static setupCommonMocks() {
    // Mock config
    jest.mock('config', () => ({
      get: jest.fn((key: string) => {
        const mockConfig: { [key: string]: any } = {
          'Server.port': 8080,
          'Server.debug': false,
          'Server.path': '/amazon',
          'Server.cors': false,
          'Server.projectDir': '/mock/project',
          'Server.httpCache': 3600,
          'Amazon.accessKey': 'mock-access-key',
          'Amazon.secretKey': 'mock-secret-key',
          'Amazon.host': 'webservices.amazon.fr',
          'Amazon.region': 'eu-west-1',
          'Amazon.partnerTag': 'mock-tag-20',
          'Amazon.partnerType': 'Associates',
          'Amazon.condition': 'New',
          'Amazon.marketplace': 'www.amazon.fr',
          'Redis.enabled': false,
          'Redis.host': 'localhost',
          'Redis.port': 6379,
          'Redis.expire': 3600
        };
        return mockConfig[key];
      })
    }));

    // Mock logger
    jest.mock('../../src/utils/ConfigLog4j', () => ({
      getLogger: () => TestUtils.createMockLogger()
    }));

    // Mock Redis
    jest.mock('ioredis', () => {
      return jest.fn().mockImplementation(() => TestUtils.createMockRedisCache());
    });
  }
}

// Performance testing utilities
export class PerformanceTestUtils {
  
  /**
   * Measure execution time of a function
   */
  static async measureExecutionTime<T>(
    fn: () => Promise<T> | T,
    label: string = 'Operation'
  ): Promise<{ result: T; duration: number }> {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    console.log(`${label} took ${duration.toFixed(2)}ms`);
    
    return { result, duration };
  }

  /**
   * Test memory usage
   */
  static getMemoryUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  }

  /**
   * Run a performance benchmark
   */
  static async benchmark(
    fn: () => Promise<any> | any,
    iterations: number = 100,
    label: string = 'Benchmark'
  ): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    totalTime: number;
    iterations: number;
  }> {
    const times: number[] = [];
    
    for (let i = 0; i < iterations; i++) {
      const { duration } = await this.measureExecutionTime(fn, `${label} #${i + 1}`);
      times.push(duration);
    }
    
    const totalTime = times.reduce((sum, time) => sum + time, 0);
    const averageTime = totalTime / iterations;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    return {
      averageTime,
      minTime,
      maxTime,
      totalTime,
      iterations
    };
  }
}

// Export default test utilities
export default TestUtils;