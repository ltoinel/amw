/**
 * Amazon Creators API client (successor of the Product Advertising API, hence the class name).
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { getLogger, Logger } from "../utils/logger";
import { metrics } from "../utils/metrics";
import {
  ApiClient,
  TypedDefaultApi,
  GetItemsRequestContent,
  GetItemsResource,
  SearchItemsRequestContent,
  SearchItemsResource,
  Condition
} from 'amazon-creators-api';
import { classifyAmazonError } from "./AmazonError";
import { loadSettings, Settings } from "./Settings";

/**
 * Fetches a single product from Amazon and maps it to the widget's flat product format.
 */
class Paapi {

  // Upper bound on an Amazon call: past it, AmwApi answers 504 instead of holding the socket
  public static readonly REQUEST_TIMEOUT: number = 30000;
  // The SDK aborts its request just after AmwApi has answered 504 (60 s by default), so that
  // a call nobody waits for no longer holds a socket, nor overlaps with the next attempt
  private static readonly CLIENT_TIMEOUT: number = Paapi.REQUEST_TIMEOUT + 1000;

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

  /**
   * @param settings Read from the configuration files when omitted.
   */
  public constructor(settings: Settings = loadSettings()) {
    const amazon = settings.amazon;
    // In debug mode full Amazon responses are logged
    this.debug = settings.server.debug;
    this.log = getLogger("Paapi");

    // Endpoint overrides exist so end-to-end tests can target a mock Amazon API;
    // when unset, the SDK keeps its production defaults.
    const apiClient = amazon.apiBasePath ? new ApiClient(amazon.apiBasePath) : new ApiClient();
    apiClient.credentialId = amazon.credentialId;
    apiClient.credentialSecret = amazon.credentialSecret;
    apiClient.version = amazon.version;
    apiClient.timeout = Paapi.CLIENT_TIMEOUT;
    if (amazon.authEndpoint) {
      apiClient.authEndpoint = amazon.authEndpoint;
    }

    this.api = new TypedDefaultApi(apiClient);
    this.partnerTag = amazon.partnerTag;
    this.marketplace = amazon.marketplace;
    this.condition = amazon.condition;

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
   * @returns The product, or null when Amazon reports that it does not exist.
   * @throws AmazonError when the Amazon call fails (timeout, throttling, other upstream error).
   */
  public async getItemApi(itemId: string) {
    const getItemsRequest = new GetItemsRequestContent(this.partnerTag, [itemId]);
    getItemsRequest.condition = Condition.constructFromObject(this.condition);
    getItemsRequest.resources = this.defaultResources.map(r => GetItemsResource.constructFromObject(r));

    try {
      const data = await metrics.observeAmazonCall('getItems',
        () => this.api.getItems(this.marketplace, getItemsRequest),
        (result) => (result.itemsResult?.items?.length ? 'found' : 'not_found'));

      if (this.debug) {
        this.onSuccess(data);
      }

      if (!data.itemsResult || !data.itemsResult.items || data.itemsResult.items.length === 0) {
        this.log.warn(`No product found for: ${itemId}`);
        return null;
      }

      return this.buildProductOrNull(data.itemsResult.items[0], itemId);

    } catch (error) {
      return this.handleApiError(error, itemId);
    }
  }

  /**
   * One GetItems call for several ASINs (Amazon accepts up to 10 per call).
   * @returns The products found, keyed by ASIN; requested ASINs absent from the map do not exist.
   * @throws AmazonError when the Amazon call fails (timeout, throttling, other upstream error).
   */
  public async getItemsApi(itemIds: string[]): Promise<Map<string, ReturnType<Paapi['buildProduct']>>> {
    const getItemsRequest = new GetItemsRequestContent(this.partnerTag, itemIds);
    getItemsRequest.condition = Condition.constructFromObject(this.condition);
    getItemsRequest.resources = this.defaultResources.map(r => GetItemsResource.constructFromObject(r));

    const products = new Map<string, ReturnType<Paapi['buildProduct']>>();
    try {
      // One observation per Amazon call: `found` as soon as one of the requested ASINs exists
      const data = await metrics.observeAmazonCall('getItems',
        () => this.api.getItems(this.marketplace, getItemsRequest),
        (result) => (result.itemsResult?.items?.length ? 'found' : 'not_found'));

      if (this.debug) {
        this.onSuccess(data);
      }

      for (const item of data.itemsResult?.items ?? []) {
        const product = this.buildProductOrNull(item, item?.asin);
        if (product && product.asin) {
          products.set(product.asin, product);
        }
      }
    } catch (error) {
      this.handleApiError(error, itemIds.join(','));
    }

    for (const id of itemIds.filter(id => !products.has(id))) {
      this.log.warn(`No product found for: ${id}`);
    }
    return products;
  }

  /**
   * @param keyword Free-text search; only the best match is returned.
   * @returns The product, or null when nothing matches.
   * @throws AmazonError when the Amazon call fails (timeout, throttling, other upstream error).
   */
  public async searchItemApi(keyword: string) {
    const searchItemsRequest = new SearchItemsRequestContent();
    searchItemsRequest.partnerTag = this.partnerTag;
    searchItemsRequest.keywords = keyword;
    searchItemsRequest.itemCount = 1;
    searchItemsRequest.condition = Condition.constructFromObject(this.condition);
    searchItemsRequest.resources = this.defaultResources.map(r => SearchItemsResource.constructFromObject(r));

    try {
      const data = await metrics.observeAmazonCall('searchItems',
        () => this.api.searchItems(this.marketplace, searchItemsRequest),
        (result) => (result.searchResult?.items?.length ? 'found' : 'not_found'));

      if (this.debug) {
        this.onSuccess(data);
      }

      if (!data.searchResult || !data.searchResult.items || data.searchResult.items.length === 0) {
        this.log.warn(`No product found for: ${keyword}`);
        return null;
      }

      return this.buildProductOrNull(data.searchResult.items[0], keyword);

    } catch (error) {
      return this.handleApiError(error, keyword);
    }
  }

  /**
   * An item lacking mandatory fields (e.g. no image) cannot be displayed: it is reported as not
   * found rather than as an Amazon failure, which would wrongly count against upstream health.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildProductOrNull(item: any, identifier: string) {
    try {
      return this.buildProduct(item);
    } catch (error) {
      this.log.warn(`Unusable product data for ${identifier}: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * A 404 from Amazon means "no such item" and resolves to null; every other failure is rethrown
   * as an AmazonError so that callers never confuse an outage with a missing product.
   */
  private handleApiError(error: unknown, identifier: string): null {
    const amazonError = classifyAmazonError(error);
    if (!amazonError) {
      this.log.warn(`No product found for: ${identifier}`);
      return null;
    }
    this.onError(error);
    throw amazonError;
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


