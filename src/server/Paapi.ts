/**
 * Amazon Product API Class.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { Factory } from "../utils/ConfigLog4j";
import { Logger } from "typescript-logging";
import config from "config";
import * as ProductAdvertisingAPIv1 from "../../lib/paapi5/src/index";

/**
 * Paapi Wrapper
 */
class Paapi {

  private defaultClient: any;
  private api: any;
  private debug: boolean;
  private log: Logger;

  // Amazon information
  private partnerTag: string;
  private partnerType: string;
  private condition: string;
  private marketplace: string;

  // The default resources to retrieve fro Amazon
  private defaultResources = [
    'Images.Primary.Large',
    'ItemInfo.Title',
    'Offers.Listings.Price',
    'Offers.Listings.DeliveryInfo.IsPrimeEligible',
    'Offers.Listings.Promotions'];

  /**
   * Default constructor
   */
  public constructor() {

    // The NPM package is not up to date regarding the Zip available.
    // https://webservices.amazon.com/paapi5/documentation/quick-start/using-sdk.html
    // var ProductAdvertisingAPIv1 = require('paapi5-nodejs-sdk');

    // Debug the API calls
    this.debug = config.get('Server.debug');

    // DefaultClient initialization
    this.defaultClient =  ProductAdvertisingAPIv1.ApiClient.instance;
    this.defaultClient.accessKey = config.get('Amazon.accessKey');
    this.defaultClient.secretKey = config.get('Amazon.secretKey');
    this.defaultClient.host = config.get('Amazon.host');
    this.defaultClient.region = config.get('Amazon.region');

    // Amazong information
    this.partnerTag = config.get('Amazon.partnerTag');
    this.partnerType = config.get('Amazon.partnerType');
    this.condition = config.get('Amazon.condition');
    this.marketplace = config.get('Amazon.marketplace');

    // API Initialisation
    this.api = new ProductAdvertisingAPIv1.DefaultApi();

    // Initialize the logger
    this.log = Factory.getLogger("paapi");
  }

  /**
   * Function to parse PAAPI responses into an object with key as ASIN
   */
  private parseResponse(itemsResponseList: any) {
    const mappedResponse: any = {};
    for (const i in itemsResponseList) {
      if (itemsResponseList.hasOwnProperty(i)) {
        mappedResponse[itemsResponseList[i].ASIN] = itemsResponseList[i];
      }
    }
    return mappedResponse;
  }

  /**
   * On Success Handler to debug Amazon PAAPI responses.
   */
  private onSuccess(response: any) {
    this.log.info('API called successfully.');
    this.log.info('Complete Response: \n' + JSON.stringify(response, null, 1));

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
   * @param {*} error
   */
  private onError(error: any) {
    this.log.error('Error calling PA-API 5.0!');
    this.log.error('Printing Full Error Object:\n' + JSON.stringify(error, null, 1));
    this.log.error('Status Code: ' + error.status);
    if (error.response !== undefined && error.response.text !== undefined) {
      this.log.error('Error Object: ' + JSON.stringify(error.response.text, null, 1));
    }
  }

  /**
   * This function allows to search a product by its ID.
   *
   * @param {string} itemId The product ID to search.
   */
  public async getItemApi(itemId: string) {

    // GetItem Request Initialization
    const getItemsRequest = new ProductAdvertisingAPIv1.GetItemsRequest();
    getItemsRequest.PartnerTag = this.partnerTag;
    getItemsRequest.PartnerType = this.partnerType;
    getItemsRequest.Condition = this.condition;
    getItemsRequest.Marketplace = this.marketplace;
    getItemsRequest.Resources = this.defaultResources;

    // Enter the Item IDs for which item information is desired
    getItemsRequest.ItemIds = [];
    getItemsRequest.ItemIds.push(itemId);
    let data;

    // Call the API
    try {
      data = await this.api.getItems(getItemsRequest);
    } catch (e) {
      this.onError(e);
    }

    // Get the response
    const getItemsResponse =  ProductAdvertisingAPIv1.GetItemsResponse.constructFromObject(data);
    if (this.debug) this.onSuccess(getItemsResponse);

    // If We didn't find the product
    if (getItemsResponse.ItemsResult === undefined){
      return null;
    }

    // We use the first item only
    const item = getItemsResponse.ItemsResult.Items[0];

    // Build a response
    const product = {
      image: item.Images.Primary.Large.URL,
      title: item.ItemInfo.Title.DisplayValue,
      url: item.DetailPageURL,
      prime: false,
      price: -1,
      timestamp: Date.now()
    };

    // Get the listing values
    if (item.Offers && item.Offers.Listings && item.Offers.Listings.length > 0) {
      product.price = item.Offers.Listings[0].Price.DisplayAmount;
      product.prime = item.Offers.Listings[0].DeliveryInfo.IsPrimeEligible;
      // promotion: item.Offers.Listings[0].Promotions.DiscountPercent,
    }

    this.log.info('Product: \n' + JSON.stringify(product, null, 1));

    return product;
  }

  /**
   * This functions allows to search a product by a keyword.
   *
   * @param {string} keyword The keyword that describes the product to search.
   */
  public async searchItemApi(keyword: string) {

    // Search Item Request Initialization
    const searchItemsRequest = new ProductAdvertisingAPIv1.SearchItemsRequest();
    searchItemsRequest.PartnerTag = this.partnerTag;
    searchItemsRequest.PartnerType = this.partnerType;
    searchItemsRequest.ItemCount = 1;
    searchItemsRequest.Condition = this.condition;
    searchItemsRequest.Marketplace = this.marketplace;
    searchItemsRequest.Resources = this.defaultResources;

    // Enter the keyword to find
    searchItemsRequest.Keywords = keyword;
    let data;

    // Call the API
    try {
       data = await this.api.searchItems(searchItemsRequest);
    } catch (e) {
      this.onError(e);
    }

    const searchItemsResponse = ProductAdvertisingAPIv1.SearchItemsResponse.constructFromObject(data);
    if (this.debug) this.onSuccess(searchItemsResponse);

    // If We didn't find the product
    if (searchItemsResponse.ItemsResult === undefined){
      return null;
    }

    // We use the first search result
    const item = searchItemsResponse.SearchResult.Items[0];

    // Build a response
    const product = {
      image: item.Images.Primary.Large.URL,
      title: item.ItemInfo.Title.DisplayValue,
      url: item.DetailPageURL,
      prime: false,
      price: "Non disponible en stock",
      timestamp: Date.now()
    };

    // Get the listing values
    if (item.Offers && item.Offers.Listings && item.Offers.Listings.length > 0) {
      product.price = item.Offers.Listings[0].Price.DisplayAmount;
      product.prime = item.Offers.Listings[0].DeliveryInfo.IsPrimeEligible;
      // promotion: item.Offers.Listings[0].Promotions.DiscountPercent,
    }

    return product;
  }
}

export { Paapi };