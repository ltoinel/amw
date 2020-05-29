/**
 * Amazon Product API Wrapper module.
 * 
 * @author : ltoinel@free.Fr
 */

const config = require('config');
var ProductAdvertisingAPIv1 = require('../lib/paapi5/src/index');

// The NPM package is not up to date regarding the Zip available.
// https://webservices.amazon.com/paapi5/documentation/quick-start/using-sdk.html
// var ProductAdvertisingAPIv1 = require('paapi5-nodejs-sdk');

// Debug the API calls
var debug = config.get('Server.debug');

// DefaultClient initialization
var defaultClient = ProductAdvertisingAPIv1.ApiClient.instance;
defaultClient.accessKey = config.get('Amazon.accessKey');
defaultClient.secretKey = config.get('Amazon.secretKey');
defaultClient.host = config.get('Amazon.host');
defaultClient.region = config.get('Amazon.region');

// API Initialisation
var api = new ProductAdvertisingAPIv1.DefaultApi();

// GetItem Request Initialization
var getItemsRequest = new ProductAdvertisingAPIv1.GetItemsRequest();
getItemsRequest['PartnerTag'] = config.get('Amazon.partnerTag');
getItemsRequest['PartnerType'] = config.get('Amazon.partnerType');
getItemsRequest['Condition'] = 'New';
getItemsRequest['Marketplace'] = 'www.amazon.fr';
getItemsRequest['Resources'] = [
  'Images.Primary.Large', 
  'ItemInfo.Title', 
  'Offers.Listings.Price', 
  'Offers.Listings.DeliveryInfo.IsPrimeEligible',
  'Offers.Listings.Promotions'];

// Search Item Request Initialization
var searchItemsRequest = new ProductAdvertisingAPIv1.SearchItemsRequest();
searchItemsRequest['PartnerTag'] = config.get('Amazon.partnerTag');
searchItemsRequest['PartnerType'] = config.get('Amazon.partnerType');
searchItemsRequest['ItemCount'] = 1;
searchItemsRequest['Resources'] = [
  'Images.Primary.Large', 
  'ItemInfo.Title', 
  'Offers.Listings.Price', 
  'Offers.Listings.DeliveryInfo.IsPrimeEligible',
  'Offers.Listings.Promotions'];

/**
 * On Search Items Success.
 * @param {*} data 
 */
function onSearchItemsSuccess(data) {
  console.log('API called successfully.');
  var searchItemsResponse = ProductAdvertisingAPIv1.SearchItemsResponse.constructFromObject(data);
  console.log('Complete Response: \n' + JSON.stringify(searchItemsResponse, null, 1));
  if (searchItemsResponse['SearchResult'] !== undefined) {
    console.log('Printing First Item Information in SearchResult:');
    var item_0 = searchItemsResponse['SearchResult']['Items'][0];
    if (item_0 !== undefined) {
      if (item_0['ASIN'] !== undefined) {
        console.log('ASIN: ' + item_0['ASIN']);
      }
      if (item_0['DetailPageURL'] !== undefined) {
        console.log('DetailPageURL: ' + item_0['DetailPageURL']);
      }
      if (
        item_0['ItemInfo'] !== undefined &&
        item_0['ItemInfo']['Title'] !== undefined &&
        item_0['ItemInfo']['Title']['DisplayValue'] !== undefined
      ) {
        console.log('Title: ' + item_0['ItemInfo']['Title']['DisplayValue']);
      }
      if (
        item_0['Offers'] !== undefined &&
        item_0['Offers']['Listings'] !== undefined &&
        item_0['Offers']['Listings'][0]['Price'] !== undefined &&
        item_0['Offers']['Listings'][0]['Price']['DisplayAmount'] !== undefined
      ) {
        console.log('Buying Price: ' + item_0['Offers']['Listings'][0]['Price']['DisplayAmount']);
      }
    }
  }
  if (searchItemsResponse['Errors'] !== undefined) {
    console.log('Errors:');
    console.log('Complete Error Response: ' + JSON.stringify(searchItemsResponse['Errors'], null, 1));
    console.log('Printing 1st Error:');
    var error_0 = searchItemsResponse['Errors'][0];
    console.log('Error Code: ' + error_0['Code']);
    console.log('Error Message: ' + error_0['Message']);
  }
}


/**
 * Function to parse GetItemsResponse into an object with key as ASIN
 */
function parseResponse(itemsResponseList) {
  var mappedResponse = {};
  for (var i in itemsResponseList) {
    if (itemsResponseList.hasOwnProperty(i)) {
      mappedResponse[itemsResponseList[i]['ASIN']] = itemsResponseList[i];
    }
  }
  return mappedResponse;
}

/**
 * On GetItems Success Handler
 */
function onGetItemsSuccess(data) {
  console.log('API called successfully.');
  var getItemsResponse = ProductAdvertisingAPIv1.GetItemsResponse.constructFromObject(data);
  console.log('Complete Response: \n' + JSON.stringify(getItemsResponse, null, 1));
  if (getItemsResponse['ItemsResult'] !== undefined) {
    console.log('Printing All Item Information in ItemsResult:');
    var response_list = parseResponse(getItemsResponse['ItemsResult']['Items']);
    for (var i in getItemsRequest['ItemIds']) {
      if (getItemsRequest['ItemIds'].hasOwnProperty(i)) {
        var itemId = getItemsRequest['ItemIds'][i];
        console.log('\nPrinting information about the Item with Id: ' + itemId);
        if (itemId in response_list) {
          var item = response_list[itemId];
          if (item !== undefined) {
            if (item['ASIN'] !== undefined) {
              console.log('ASIN: ' + item['ASIN']);
            }
            if (item['DetailPageURL'] !== undefined) {
              console.log('DetailPageURL: ' + item['DetailPageURL']);
            }
            if (
              item['ItemInfo'] !== undefined &&
              item['ItemInfo']['Title'] !== undefined &&
              item['ItemInfo']['Title']['DisplayValue'] !== undefined
            ) {
              console.log('Title: ' + item['ItemInfo']['Title']['DisplayValue']);
            }
            if (
              item['Offers'] !== undefined &&
              item['Offers']['Listings'] !== undefined &&
              item['Offers']['Listings'][0]['Price'] !== undefined &&
              item['Offers']['Listings'][0]['Price']['DisplayAmount'] !== undefined
            ) {
              console.log('Buying Price: ' + item['Offers']['Listings'][0]['Price']['DisplayAmount']);
            }
          }
        } else {
          console.log('Item not found, check errors');
        }
      }
    }
  }
  if (getItemsResponse['Errors'] !== undefined) {
    console.log('\nErrors:');
    console.log('Complete Error Response: ' + JSON.stringify(getItemsResponse['Errors'], null, 1));
    console.log('Printing 1st Error:');
    var error_0 = getItemsResponse['Errors'][0];
    console.log('Error Code: ' + error_0['Code']);
    console.log('Error Message: ' + error_0['Message']);
  }
}


/**
 * On Error Handler
 * @param {*} error 
 */
function onError(error) {
  console.log('Error calling PA-API 5.0!');
  console.log('Printing Full Error Object:\n' + JSON.stringify(error, null, 1));
  console.log('Status Code: ' + error['status']);
  if (error['response'] !== undefined && error['response']['text'] !== undefined) {
    console.log('Error Object: ' + JSON.stringify(error['response']['text'], null, 1));
  }
}


// Module function declaration
var getItemApi = function (itemId, callback){

  // Enter the Item IDs for which item information is desired
  getItemsRequest['ItemIds'] = [];
  getItemsRequest['ItemIds'].push(itemId);

  // Call the API
  var data =  api.getItems(getItemsRequest).then(
    function(data) {
      if (debug) onGetItemsSuccess(data);
      var getItemsResponse = ProductAdvertisingAPIv1.GetItemsResponse.constructFromObject(data);
      var item = getItemsResponse.ItemsResult.Items[0];

      // Build a response
      var product = {
        image : item.Images.Primary.Large.URL,
        title :item.ItemInfo.Title.DisplayValue,
        url : item.DetailPageURL,
        prime :  false,
        price : "No disponible en stock",
        timestamp : Date.now()
      };

      // Get the listing values
      if (item.Offers &&  item.Offers.Listings  && item.Offers.Listings.length > 0){
        product.price = item.Offers.Listings[0].Price.DisplayAmount;
        product.prime = item.Offers.Listings[0].DeliveryInfo.IsPrimeEligible;
       //promotion: item.Offers.Listings[0].Promotions.DiscountPercent,
      }

      callback(product);
    },
    function(error) {
      onError(error);
      callback(null,error);
    }
  );
}


// Module function declaration
var searchItemApi = function (keyword, callback){

  // Enter the keyword to find
  searchItemsRequest['Keywords'] = keyword;

  // Call the API
  var data =  api.searchItems(searchItemsRequest).then(

    function(data) {

      if (debug) onSearchItemsSuccess(data);
      var searchItemsResponse = ProductAdvertisingAPIv1.SearchItemsResponse.constructFromObject(data);
      var item = searchItemsResponse.SearchResult.Items[0];

      // Build a response
      var product = {
        image : item.Images.Primary.Large.URL,
        title :item.ItemInfo.Title.DisplayValue,
        url : item.DetailPageURL,
        prime :  false,
        price : "No disponible en stock",
        timestamp : Date.now()
      };

      // Get the listing values
      if (item.Offers &&  item.Offers.Listings  && item.Offers.Listings.length > 0){
        product.price = item.Offers.Listings[0].Price.DisplayAmount;
        product.prime = item.Offers.Listings[0].DeliveryInfo.IsPrimeEligible;
       //promotion: item.Offers.Listings[0].Promotions.DiscountPercent,
      }

      callback(product);
    },
    function(error) {
      onError(error);
      callback(null,error);
    }
  );
}

// Export the module functions
exports.getItemApi =  getItemApi;
exports.searchItemApi =  searchItemApi;

