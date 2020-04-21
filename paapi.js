
const config = require('config');
var ProductAdvertisingAPIv1 = require('./src/index');

// DefaultClient initialization
var defaultClient = ProductAdvertisingAPIv1.ApiClient.instance;
defaultClient.accessKey = config.get('Amazon.accessKey');
defaultClient.secretKey = config.get('Amazon.secretKey');
defaultClient.host = config.get('Amazon.host');
defaultClient.region = config.get('Amazon.region');
console.log('DefaultClient Object: ' + JSON.stringify(defaultClient));

// API Initialisation
var api = new ProductAdvertisingAPIv1.DefaultApi();

// Request Initialization
var getItemsRequest = new ProductAdvertisingAPIv1.GetItemsRequest();
getItemsRequest['PartnerTag'] = config.get('Amazon.partnerTag');
getItemsRequest['PartnerType'] = config.get('Amazon.partnerType');
getItemsRequest['Condition'] = 'New';
getItemsRequest['Marketplace'] = 'www.amazon.fr';
getItemsRequest['Resources'] = ['Images.Primary.Medium', 'ItemInfo.Title', 'Offers.Listings.Price'];
console.log('Request Object: ' + JSON.stringify(getItemsRequest));

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
 * onSuccess Handler
 */
function onSuccess(data) {
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
 * onError Handler
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
var getItemsApi =  async function(itemId){

  // Enter the Item IDs for which item information is desired
  getItemsRequest['ItemIds'] = [];
  getItemsRequest['ItemIds'].push(itemId);

  // Call the API
  api.getItems(getItemsRequest).then(
    function(data) {
      onSuccess(data);
      var getItemsResponse = ProductAdvertisingAPIv1.GetItemsResponse.constructFromObject(data);
      return getItemsResponse;
    },
    function(error) {
      onError(error);
    }
  );
}

// Export the module functions
exports.getItemsApi = getItemsApi;
