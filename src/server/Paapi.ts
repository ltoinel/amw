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
import {
  ApiClient,
  TypedDefaultApi,
  GetItemsRequestContent,
  GetItemsResource,
  SearchItemsRequestContent,
  SearchItemsResource,
  Condition
} from 'amazon-creators-api';

/**
 * Paapi Wrapper using amazon-creators-api library
 */
class Paapi {

  private debug: boolean;
  private log: Logger;

  // Amazon Creators API client
  private api: TypedDefaultApi;

  // Partner tag for affiliate tracking
  private partnerTag: string;

  // Marketplace (e.g. www.amazon.fr)
  private marketplace: string;

  // Amazon condition filter
  private condition: string;

  // Default resources to retrieve from Amazon
  private defaultResources = [
    'images.primary.large',
    'itemInfo.title',
    'itemInfo.byLineInfo',
    'offersV2.listings.price'
  ];

  /**
   * Default constructor
   */
  public constructor() {
    // Debug the API calls
    this.debug = config.get('Server.debug');

    // Setup the logger
    this.log = getLogger("Paapi");

    // Initialize Amazon Creators API client
    const apiClient = new ApiClient();
    apiClient.credentialId = config.get('Amazon.credentialId');
    apiClient.credentialSecret = config.get('Amazon.credentialSecret');
    apiClient.version = config.get('Amazon.version');

    this.api = new TypedDefaultApi(apiClient);
    this.partnerTag = config.get('Amazon.partnerTag');
    this.marketplace = config.get('Amazon.marketplace');
    this.condition = config.get('Amazon.condition');

    this.log.info(`Amazon Creators API initialized for marketplace: ${this.marketplace}`);
  }

  /**
   * Log success response for debugging
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onSuccess(response: any) {
    this.log.debug('API called successfully.');
    this.log.debug('Complete Response: \n' + JSON.stringify(response, null, 1));

    if (response.errors !== undefined) {
      this.log.debug('\nErrors:');
      this.log.debug('Complete Error Response: ' + JSON.stringify(response.errors, null, 1));
      this.log.debug('Printing 1st Error:');
      const error = response.errors[0];
      this.log.debug('Error Code: ' + error.code);
      this.log.debug('Error Message: ' + error.message);
    }
  }

  /**
   * On Error Handler
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onError(error: any) {
    this.log.error('Error calling Amazon Creators API!');
    if (error instanceof Error) {
      this.log.error('Error message: ' + error.message);
      if (this.debug && error.stack) {
        this.log.error('Stack: ' + error.stack);
      }
    } else {
      // HTTP response error: extract status and body
      const status = error?.status ?? error?.statusCode ?? error?.response?.status ?? 'unknown';
      const body = error?.response?.body ?? error?.body ?? error?.text ?? error;
      this.log.error(`HTTP ${status} - ${typeof body === 'object' ? JSON.stringify(body, null, 1) : body}`);
    }
  }

  /**
   * This function allows to search a product by its ID.
   *
   * @param {string} itemId The product ID to search.
   */
  public async getItemApi(itemId: string) {
    const getItemsRequest = new GetItemsRequestContent(this.partnerTag, [itemId]);
    getItemsRequest.condition = Condition.constructFromObject(this.condition);
    getItemsRequest.resources = this.defaultResources.map(r => GetItemsResource.constructFromObject(r));

    try {
      const data = await this.api.getItems(this.marketplace, getItemsRequest);

      if (this.debug) {
        this.onSuccess(data);
      }

      // Check if we have items in the response
      if (!data.itemsResult || !data.itemsResult.items || data.itemsResult.items.length === 0) {
        this.log.warn(`No product found for: ${itemId}`);
        return null;
      }

      // Build and return the product from the first item
      const product = this.buildProduct(data.itemsResult.items[0]);
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
    const searchItemsRequest = new SearchItemsRequestContent();
    searchItemsRequest.partnerTag = this.partnerTag;
    searchItemsRequest.keywords = keyword;
    searchItemsRequest.itemCount = 1;
    searchItemsRequest.condition = Condition.constructFromObject(this.condition);
    searchItemsRequest.resources = this.defaultResources.map(r => SearchItemsResource.constructFromObject(r));

    try {
      const data = await this.api.searchItems(this.marketplace, searchItemsRequest);

      if (this.debug) {
        this.onSuccess(data);
      }

      // Check if we have search results
      if (!data.searchResult || !data.searchResult.items || data.searchResult.items.length === 0) {
        this.log.warn(`No product found for: ${keyword}`);
        return null;
      }

      // Build and return the product from the first search result
      const product = this.buildProduct(data.searchResult.items[0]);
      return product;

    } catch (error) {
      this.onError(error);
      return null;
    }
  }


  /**
   * Build a product from an item.
   * 
   * @param item the item to build
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public buildProduct(item: any) {

    const product = {
      image: item.images.primary.large.url,
      title: item.itemInfo.title.displayValue,
      url: item.detailPageURL,
      brand: item.itemInfo?.byLineInfo?.brand?.displayValue || '',
      asin: item.asin || '',
      price: -1,
      timestamp: Date.now(),
      savings: 0
    };

    // Get the first offer only
    if (item.offersV2 && item.offersV2.listings && item.offersV2.listings.length > 0) {

      product.price = item.offersV2.listings[0].price.money.displayAmount;

      // If savings exists
      if (item.offersV2.listings[0].price.savings) {
        product.savings = item.offersV2.listings[0].price.savings.percentage;
      }
    } else {
      this.log.warn('No offer found for : ' + item.asin);
    }

    return product;

  }

}

export { Paapi };


