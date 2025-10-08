/**
 * Unit tests for utility functions and core business logic
 */

describe('AMW Core Functionality Tests', () => {
  
  describe('Product Builder Logic', () => {
    const buildProduct = (item: any) => {
      if (!item) {
        throw new Error('Item is required');
      }

      const product = {
        image: item.Images?.Primary?.Large?.URL || '',
        title: item.ItemInfo?.Title?.DisplayValue || '',
        url: item.DetailPageURL || '',
        prime: false,
        price: -1,
        timestamp: Date.now(),
        savings: 0
      };

      // Process offers if available
      if (item.Offers && item.Offers.Listings && item.Offers.Listings.length > 0) {
        const firstListing = item.Offers.Listings[0];
        
        if (firstListing.Price) {
          product.price = firstListing.Price.DisplayAmount || -1;
        }
        
        if (firstListing.DeliveryInfo) {
          product.prime = firstListing.DeliveryInfo.IsPrimeEligible || false;
        }
        
        if (firstListing.Price?.Savings) {
          product.savings = firstListing.Price.Savings.Percentage || 0;
        }
      }

      return product;
    };

    test('should build complete product from Amazon item data', () => {
      const amazonItem = {
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
        }
      };

      const result = buildProduct(amazonItem);

      expect(result).toMatchObject({
        image: 'https://m.media-amazon.com/images/I/71ABC123DEF.jpg',
        title: 'Arduino Uno R3 - Microcontroller Board',
        url: 'https://www.amazon.fr/dp/B084DN3XVN',
        prime: true,
        price: '€24.99',
        savings: 15
      });
      expect(result.timestamp).toBeGreaterThan(0);
    });

    test('should handle product without offers', () => {
      const amazonItem = {
        ASIN: 'B123456789',
        Images: {
          Primary: {
            Large: {
              URL: 'https://example.com/product.jpg'
            }
          }
        },
        ItemInfo: {
          Title: {
            DisplayValue: 'Sample Product'
          }
        },
        DetailPageURL: 'https://www.amazon.fr/dp/B123456789'
      };

      const result = buildProduct(amazonItem);

      expect(result).toMatchObject({
        image: 'https://example.com/product.jpg',
        title: 'Sample Product',
        url: 'https://www.amazon.fr/dp/B123456789',
        prime: false,
        price: -1,
        savings: 0
      });
    });

    test('should handle missing optional fields', () => {
      const amazonItem = {
        ASIN: 'B987654321'
      };

      const result = buildProduct(amazonItem);

      expect(result).toMatchObject({
        image: '',
        title: '',
        url: '',
        prime: false,
        price: -1,
        savings: 0
      });
    });

    test('should throw error for null item', () => {
      expect(() => buildProduct(null)).toThrow('Item is required');
      expect(() => buildProduct(undefined)).toThrow('Item is required');
    });
  });

  describe('Response Parser Logic', () => {
    const parseResponse = (itemsResponseList: any[]) => {
      const mappedResponse: any = {};
      for (const i in itemsResponseList) {
        if (itemsResponseList.hasOwnProperty(i)) {
          mappedResponse[itemsResponseList[i].ASIN] = itemsResponseList[i];
        }
      }
      return mappedResponse;
    };

    test('should parse Amazon API response correctly', () => {
      const apiResponse = [
        { ASIN: 'B084DN3XVN', title: 'Arduino Uno', price: '€24.99' },
        { ASIN: 'B123456789', title: 'Raspberry Pi', price: '€39.99' },
        { ASIN: 'B987654321', title: 'ESP32 Board', price: '€15.99' }
      ];

      const result = parseResponse(apiResponse);

      expect(result).toEqual({
        'B084DN3XVN': { ASIN: 'B084DN3XVN', title: 'Arduino Uno', price: '€24.99' },
        'B123456789': { ASIN: 'B123456789', title: 'Raspberry Pi', price: '€39.99' },
        'B987654321': { ASIN: 'B987654321', title: 'ESP32 Board', price: '€15.99' }
      });
    });

    test('should handle empty response', () => {
      const result = parseResponse([]);
      expect(result).toEqual({});
    });

    test('should handle single item response', () => {
      const apiResponse = [
        { ASIN: 'B084DN3XVN', title: 'Single Product' }
      ];

      const result = parseResponse(apiResponse);

      expect(result).toEqual({
        'B084DN3XVN': { ASIN: 'B084DN3XVN', title: 'Single Product' }
      });
    });
  });

  describe('Error Handling Logic', () => {
    const handleApiError = (error: any) => {
      if (error.Code) {
        return {
          success: false,
          error: {
            code: error.Code,
            message: error.Message || 'Unknown API error'
          }
        };
      }
      return {
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: error.message || 'An unexpected error occurred'
        }
      };
    };

    test('should handle Amazon API errors', () => {
      const amazonError = {
        Code: 'InvalidParameterValue',
        Message: 'The ItemId B999999999 provided in the request is invalid.'
      };

      const result = handleApiError(amazonError);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'InvalidParameterValue',
          message: 'The ItemId B999999999 provided in the request is invalid.'
        }
      });
    });

    test('should handle generic errors', () => {
      const genericError = new Error('Network timeout');

      const result = handleApiError(genericError);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'Network timeout'
        }
      });
    });

    test('should handle errors without message', () => {
      const emptyError = {};

      const result = handleApiError(emptyError);

      expect(result).toEqual({
        success: false,
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'An unexpected error occurred'
        }
      });
    });
  });

  describe('Cache Key Generation', () => {
    const generateCacheKey = (type: 'id' | 'keyword', value: string) => {
      if (!value || value.trim() === '') {
        throw new Error('Cache key value cannot be empty');
      }
      return `${type}:${value.toLowerCase().trim()}`;
    };

    test('should generate cache key for product ID', () => {
      const key = generateCacheKey('id', 'B084DN3XVN');
      expect(key).toBe('id:b084dn3xvn');
    });

    test('should generate cache key for keyword search', () => {
      const key = generateCacheKey('keyword', 'Arduino Uno');
      expect(key).toBe('keyword:arduino uno');
    });

    test('should handle whitespace in values', () => {
      const key = generateCacheKey('keyword', '  Arduino  Board  ');
      expect(key).toBe('keyword:arduino  board');
    });

    test('should throw error for empty values', () => {
      expect(() => generateCacheKey('id', '')).toThrow('Cache key value cannot be empty');
      expect(() => generateCacheKey('keyword', '   ')).toThrow('Cache key value cannot be empty');
    });
  });

  describe('Configuration Validation', () => {
    const validateConfig = (config: any) => {
      const requiredFields = [
        'Amazon.accessKey',
        'Amazon.secretKey',
        'Amazon.partnerTag',
        'Server.port'
      ];

      const missing: string[] = [];
      
      for (const field of requiredFields) {
        const keys = field.split('.');
        let current = config;
        
        for (const key of keys) {
          if (!current || !current[key]) {
            missing.push(field);
            break;
          }
          current = current[key];
        }
      }

      return {
        valid: missing.length === 0,
        missing
      };
    };

    test('should validate complete configuration', () => {
      const config = {
        Amazon: {
          accessKey: 'AKIA123456789',
          secretKey: 'secretkey123',
          partnerTag: 'mytag-20'
        },
        Server: {
          port: 8080
        }
      };

      const result = validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    test('should detect missing configuration fields', () => {
      const incompleteConfig = {
        Amazon: {
          accessKey: 'AKIA123456789'
          // Missing secretKey and partnerTag
        },
        Server: {
          // Missing port
        }
      };

      const result = validateConfig(incompleteConfig);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('Amazon.secretKey');
      expect(result.missing).toContain('Amazon.partnerTag');
      expect(result.missing).toContain('Server.port');
    });
  });
});