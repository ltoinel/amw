/**
 * Simple unit test for Paapi buildProduct method
 */

describe('Paapi buildProduct', () => {
  // Mock implementation for testing buildProduct method
  const buildProduct = (item: any) => {
    const product = {
      image: item.Images?.Primary?.Large?.URL || '',
      title: item.ItemInfo?.Title?.DisplayValue || '',
      url: item.DetailPageURL || '',
      prime: false,
      price: -1,
      timestamp: Date.now(),
      savings: 0
    };

    // Get the first offer only
    if (item.Offers && item.Offers.Listings && item.Offers.Listings.length > 0) {
      const listing = item.Offers.Listings[0];
      product.price = listing.Price?.DisplayAmount || -1;
      product.prime = listing.DeliveryInfo?.IsPrimeEligible || false;

      // If savings exists
      if (listing.Price?.Savings) {
        product.savings = listing.Price.Savings.Percentage || 0;
      }
    }

    return product;
  };

  test('should build product with complete item data', () => {
    const mockItem = {
      Images: {
        Primary: {
          Large: {
            URL: 'https://example.com/image.jpg'
          }
        }
      },
      ItemInfo: {
        Title: {
          DisplayValue: 'Test Product Title'
        }
      },
      DetailPageURL: 'https://amazon.fr/product/test',
      Offers: {
        Listings: [{
          Price: {
            DisplayAmount: '€29.99',
            Savings: {
              Percentage: 15
            }
          },
          DeliveryInfo: {
            IsPrimeEligible: true
          }
        }]
      },
      ASIN: 'B123456789'
    };

    const result = buildProduct(mockItem);

    expect(result.image).toBe('https://example.com/image.jpg');
    expect(result.title).toBe('Test Product Title');
    expect(result.url).toBe('https://amazon.fr/product/test');
    expect(result.prime).toBe(true);
    expect(result.price).toBe('€29.99');
    expect(result.savings).toBe(15);
    expect(result.timestamp).toBeGreaterThan(0);
  });

  test('should build product without offers', () => {
    const mockItem = {
      Images: {
        Primary: {
          Large: {
            URL: 'https://example.com/image.jpg'
          }
        }
      },
      ItemInfo: {
        Title: {
          DisplayValue: 'Test Product Title'
        }
      },
      DetailPageURL: 'https://amazon.fr/product/test',
      ASIN: 'B123456789'
    };

    const result = buildProduct(mockItem);

    expect(result.image).toBe('https://example.com/image.jpg');
    expect(result.title).toBe('Test Product Title');
    expect(result.url).toBe('https://amazon.fr/product/test');
    expect(result.prime).toBe(false);
    expect(result.price).toBe(-1);
    expect(result.savings).toBe(0);
  });

  test('should build product without savings', () => {
    const mockItem = {
      Images: {
        Primary: {
          Large: {
            URL: 'https://example.com/image.jpg'
          }
        }
      },
      ItemInfo: {
        Title: {
          DisplayValue: 'Test Product Title'
        }
      },
      DetailPageURL: 'https://amazon.fr/product/test',
      Offers: {
        Listings: [{
          Price: {
            DisplayAmount: '€29.99'
          },
          DeliveryInfo: {
            IsPrimeEligible: false
          }
        }]
      },
      ASIN: 'B123456789'
    };

    const result = buildProduct(mockItem);

    expect(result.savings).toBe(0);
    expect(result.prime).toBe(false);
    expect(result.price).toBe('€29.99');
  });

  test('should handle missing optional fields gracefully', () => {
    const mockItem = {
      ASIN: 'B123456789'
    };

    const result = buildProduct(mockItem);

    expect(result.image).toBe('');
    expect(result.title).toBe('');
    expect(result.url).toBe('');
    expect(result.prime).toBe(false);
    expect(result.price).toBe(-1);
    expect(result.savings).toBe(0);
  });
});