/**
 * Amazon Creators API client (successor of the Product Advertising API, hence the class name).
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
 * Fetches a single product from Amazon and maps it to the widget's flat product format.
 */
class Paapi {

  private debug: boolean;
  private log: Logger;

  private api: TypedDefaultApi;

  // Affiliate tag added to product URLs, so purchases are credited to the site owner
  private partnerTag: string;

  // e.g. www.amazon.fr
  private marketplace: string;

  // Offer condition filter, e.g. New
  private condition: string;

  // Only the fields used by buildProduct(): requesting fewer resources keeps responses small
  private defaultResources = [
    'images.primary.large',
    'itemInfo.title',
    'itemInfo.byLineInfo',
    'offersV2.listings.price'
  ];

  public constructor() {
    // In debug mode full Amazon responses are logged
    this.debug = config.get('Server.debug');
    this.log = getLogger("Paapi");

    // Endpoint overrides exist so end-to-end tests can target a mock Amazon API;
    // when unset, the SDK keeps its production defaults.
    const apiBasePath: string = config.has('Amazon.apiBasePath') ? config.get('Amazon.apiBasePath') : '';
    const authEndpoint: string = config.has('Amazon.authEndpoint') ? config.get('Amazon.authEndpoint') : '';

    const apiClient = apiBasePath ? new ApiClient(apiBasePath) : new ApiClient();
    apiClient.credentialId = config.get('Amazon.credentialId');
    apiClient.credentialSecret = config.get('Amazon.credentialSecret');
    apiClient.version = config.get('Amazon.version');
    if (authEndpoint) {
      apiClient.authEndpoint = authEndpoint;
    }

    this.api = new TypedDefaultApi(apiClient);
    this.partnerTag = config.get('Amazon.partnerTag');
    this.marketplace = config.get('Amazon.marketplace');
    this.condition = config.get('Amazon.condition');

    this.log.info(`Amazon Creators API initialized for marketplace: ${this.marketplace}`);
  }

  /**
   * Debug-only dump of the raw Amazon response, including partial errors returned with a 200.
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
   * The SDK rejects with either an Error (network, auth) or an HTTP response object.
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
      const status = error?.status ?? error?.statusCode ?? error?.response?.status ?? 'unknown';
      const body = error?.response?.body ?? error?.body ?? error?.text ?? error;
      this.log.error(`HTTP ${status} - ${typeof body === 'object' ? JSON.stringify(body, null, 1) : body}`);
    }
  }

  /**
   * @param itemId Amazon product id (ASIN).
   * @returns The product, or null when it does not exist or the Amazon call failed.
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

      if (!data.itemsResult || !data.itemsResult.items || data.itemsResult.items.length === 0) {
        this.log.warn(`No product found for: ${itemId}`);
        return null;
      }

      const product = this.buildProduct(data.itemsResult.items[0]);
      return product;

    } catch (error) {
      this.onError(error);
      return null;
    }
  }

  /**
   * @param keyword Free-text search; only the best match is returned.
   * @returns The product, or null when nothing matches or the Amazon call failed.
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

      if (!data.searchResult || !data.searchResult.items || data.searchResult.items.length === 0) {
        this.log.warn(`No product found for: ${keyword}`);
        return null;
      }

      const product = this.buildProduct(data.searchResult.items[0]);
      return product;

    } catch (error) {
      this.onError(error);
      return null;
    }
  }


  /**
   * Maps an Amazon item to the JSON returned to the widget.
   * `price` is the localized display string (e.g. "29,99 €") or -1 when there is no offer.
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

    // Only the first listing is displayed
    if (item.offersV2 && item.offersV2.listings && item.offersV2.listings.length > 0) {

      product.price = item.offersV2.listings[0].price.money.displayAmount;

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


