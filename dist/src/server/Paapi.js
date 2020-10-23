"use strict";
/**
 * Amazon Product API Class.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Paapi = void 0;
const ConfigLog4j_1 = require("../utils/ConfigLog4j");
const config_1 = __importDefault(require("config"));
const ProductAdvertisingAPIv1 = __importStar(require("../../lib/paapi5/src/index"));
class Paapi {
    /**
     * Default constructor
     */
    constructor() {
        // The NPM package is not up to date regarding the Zip available.
        // https://webservices.amazon.com/paapi5/documentation/quick-start/using-sdk.html
        // var ProductAdvertisingAPIv1 = require('paapi5-nodejs-sdk');
        // The default resources to retrieve fro Amazon
        this.defaultResources = [
            'Images.Primary.Large',
            'ItemInfo.Title',
            'Offers.Listings.Price',
            'Offers.Listings.DeliveryInfo.IsPrimeEligible',
            'Offers.Listings.Promotions'
        ];
        // Debug the API calls
        this.debug = config_1.default.get('Server.debug');
        // DefaultClient initialization
        this.defaultClient = ProductAdvertisingAPIv1.ApiClient.instance;
        this.defaultClient.accessKey = config_1.default.get('Amazon.accessKey');
        this.defaultClient.secretKey = config_1.default.get('Amazon.secretKey');
        this.defaultClient.host = config_1.default.get('Amazon.host');
        this.defaultClient.region = config_1.default.get('Amazon.region');
        // Amazong information
        this.partnerTag = config_1.default.get('Amazon.partnerTag');
        this.partnerType = config_1.default.get('Amazon.partnerType');
        this.condition = config_1.default.get('Amazon.condition');
        this.marketplace = config_1.default.get('Amazon.marketplace');
        // API Initialisation
        this.api = new ProductAdvertisingAPIv1.DefaultApi();
        // Initialize the logger
        this.log = ConfigLog4j_1.Factory.getLogger("paapi");
    }
    /**
     * Function to parse PAAPI responses into an object with key as ASIN
     */
    parseResponse(itemsResponseList) {
        const mappedResponse = {};
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
    onSuccess(response) {
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
    onError(error) {
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
    getItemApi(itemId) {
        return __awaiter(this, void 0, void 0, function* () {
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
                data = yield this.api.getItems(getItemsRequest);
            }
            catch (e) {
                this.onError(e);
            }
            // Get the response
            const getItemsResponse = ProductAdvertisingAPIv1.GetItemsResponse.constructFromObject(data);
            // if (this.debug) this.onSuccess(getItemsResponse);
            // We use the first item only
            const item = getItemsResponse.ItemsResult.Items[0];
            this.log.info('item: \n' + JSON.stringify(item, null, 1));
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
        });
    }
    /**
     * This functions allows to search a product by a keyword.
     *
     * @param {string} keyword The keyword that describes the product to search.
     */
    searchItemApi(keyword) {
        return __awaiter(this, void 0, void 0, function* () {
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
                data = yield this.api.searchItems(searchItemsRequest);
            }
            catch (e) {
                this.onError(e);
            }
            const searchItemsResponse = ProductAdvertisingAPIv1.SearchItemsResponse.constructFromObject(data);
            if (this.debug)
                this.onSuccess(searchItemsResponse);
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
        });
    }
}
exports.Paapi = Paapi;
