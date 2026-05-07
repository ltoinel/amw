/**
 * Amazon Product API Class.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { getLogger } from "../utils/ConfigLog4j";
import { Logger } from "typescript-logging-log4ts-style";
import config from "config";
import * as amazonPaapi from 'amazon-paapi';

/**
 * Paapi Wrapper using amazon-paapi library
 */
class Paapi {

  private debug: boolean;
  private log: Logger;

  // Common parameters for all Amazon PAAPI requests
  private commonParameters: {
    AccessKey: string;
    SecretKey: string;
    PartnerTag: string;
    PartnerType: string;
    Marketplace: string;
  };

  // Amazon condition filter
  private condition: string;

  // Default resources to retrieve from Amazon
  private defaultResources = [
    'Images.Primary.Large',
    'ItemInfo.Title',
    'ItemInfo.ByLineInfo',
    'OffersV2.Listings.Price' // Updated to OffersV2 as per PAAPI 5.0
  ];

  /**
   * Default constructor
   */
  public constructor() {
    // Debug the API calls
    this.debug = config.get('Server.debug');

    // Setup the logger
    this.log = getLogger("Paapi");

    // Initialize common parameters for amazon-paapi
    this.commonParameters = {
      AccessKey: config.get('Amazon.accessKey'),
      SecretKey: config.get('Amazon.secretKey'),
      PartnerTag: config.get('Amazon.partnerTag'),
      PartnerType: config.get('Amazon.partnerType'),
      Marketplace: config.get('Amazon.marketplace')
    };

    this.condition = config.get('Amazon.condition');

    this.log.info(`Amazon PAAPI initialized for marketplace: ${this.commonParameters.Marketplace}`);
  }

  /**
   * Log success response for debugging
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onSuccess(response: any) {
    this.log.debug('API called successfully.');
    this.log.debug('Complete Response: \n' + JSON.stringify(response, null, 1));

    if (response.Errors !== undefined) {
      this.log.debug('\nErrors:');
      this.log.debug('Complete Error Response: ' + JSON.stringify(response.Errors, null, 1));
      this.log.debug('Printing 1st Error:');
      const error = response.Errors[0];
      this.log.debug('Error Code: ' + error.Code);
      this.log.debug('Error Message: ' + error.Message);
    }
  }

  /**
   * On Error Handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onError(error: any) {
    this.log.error('Error calling PA-API 5.0!');
    this.log.error('Error details: ' + JSON.stringify(error, null, 1));
  }

  /**
   * This function allows to search a product by its ID.
   *
   * @param {string} itemId The product ID to search.
   */
  public async getItemApi(itemId: string) {
    const requestParameters = {
      ItemIds: [itemId],
      ItemIdType: 'ASIN',
      Condition: this.condition,
      Resources: this.defaultResources
    };

    try {
      // Call Amazon PAAPI using amazon-paapi library
      const data = await amazonPaapi.GetItems(this.commonParameters, requestParameters);

      if (this.debug) {
        this.onSuccess(data);
      }

      // Check if we have items in the response
      if (!data.ItemsResult || !data.ItemsResult.Items || data.ItemsResult.Items.length === 0) {
        this.log.warn(`No product found for: ${itemId}`);
        return null;
      }

      // Build and return the product from the first item
      const product = this.buildProduct(data.ItemsResult.Items[0]);
      return product;

    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  /**
   * This functions allows to search a product by a keyword.
   *
   * @param {string} keyword The keyword that describes the product to search.
   */
  public async searchItemApi(keyword: string) {
    const requestParameters = {
      Keywords: keyword,
      ItemCount: 1,
      Condition: this.condition,
      Resources: this.defaultResources
    };

    try {
      // Call Amazon PAAPI using amazon-paapi library
      const data = await amazonPaapi.SearchItems(this.commonParameters, requestParameters);

      if (this.debug) {
        this.onSuccess(data);
      }

      // Check if we have search results
      if (!data.SearchResult || !data.SearchResult.Items || data.SearchResult.Items.length === 0) {
        this.log.warn(`No product found for: ${keyword}`);
        return null;
      }

      // Build and return the product from the first search result
      const product = this.buildProduct(data.SearchResult.Items[0]);
      return product;

    } catch (error) {
      this.onError(error);
      return null;
    }
  }


  /**
   * Build a product from an item.
   * Using any type due to Amazon PAAPI SDK not exporting item types
   * 
   * @param item the item to build
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public buildProduct(item: any) {

    const product = {
      image: item.Images.Primary.Large.URL,
      title: item.ItemInfo.Title.DisplayValue,
      url: item.DetailPageURL,
      brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue || '',
      asin: item.ASIN || '',
      price: -1,
      timestamp: Date.now(),
      savings: 0
    };

    // Get the first offer only
    if (item.OffersV2 && item.OffersV2.Listings && item.OffersV2.Listings.length > 0) {

      product.price = item.OffersV2.Listings[0].Price.Money.DisplayAmount;

      // If savings exists
      if (item.OffersV2.Listings[0].Price.Savings) {
        product.savings = item.OffersV2.Listings[0].Price.Savings.Percentage;
      }
    } else {
      this.log.warn('No offer found for : ' + item.ASIN);
    }

    return product;

  }

}

export { Paapi };


