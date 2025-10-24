/**
 * Type definitions for amazon-paapi
 * Project: https://github.com/jorgerosal/amazon-paapi
 */

declare module 'amazon-paapi' {
  /**
   * Common parameters for all Amazon PAAPI requests
   */
  export interface CommonParameters {
    AccessKey: string;
    SecretKey: string;
    PartnerTag: string;
    PartnerType?: string;
    Marketplace?: string;
  }

  /**
   * Request parameters for GetItems operation
   */
  export interface GetItemsParameters {
    ItemIds: string[];
    ItemIdType?: string;
    Condition?: string;
    Resources?: string[];
    LanguagesOfPreference?: string[];
    Merchant?: string;
  }

  /**
   * Request parameters for SearchItems operation
   */
  export interface SearchItemsParameters {
    Keywords?: string;
    SearchIndex?: string;
    ItemCount?: number;
    ItemPage?: number;
    Condition?: string;
    Resources?: string[];
    LanguagesOfPreference?: string[];
    MinPrice?: number;
    MaxPrice?: number;
    SortBy?: string;
    BrowseNodeId?: string;
    Merchant?: string;
  }

  /**
   * Request parameters for GetBrowseNodes operation
   */
  export interface GetBrowseNodesParameters {
    BrowseNodeIds: string[];
    LanguagesOfPreference?: string[];
    Resources?: string[];
  }

  /**
   * Request parameters for GetVariations operation
   */
  export interface GetVariationsParameters {
    ASIN: string;
    Condition?: string;
    Resources?: string[];
    LanguagesOfPreference?: string[];
    Merchant?: string;
    VariationCount?: number;
    VariationPage?: number;
  }

  /**
   * Amazon PAAPI item structure
   */
  export interface Item {
    ASIN: string;
    DetailPageURL: string;
    Images?: {
      Primary?: {
        Small?: { URL: string; Height: number; Width: number };
        Medium?: { URL: string; Height: number; Width: number };
        Large?: { URL: string; Height: number; Width: number };
      };
    };
    ItemInfo?: {
      Title?: { DisplayValue: string };
      [key: string]: any;
    };
    Offers?: {
      Listings?: Array<{
        Price?: {
          DisplayAmount: string;
          Amount: number;
          Currency: string;
          Savings?: {
            Amount: number;
            Currency: string;
            DisplayAmount: string;
            Percentage: number;
          };
        };
        DeliveryInfo?: {
          IsPrimeEligible: boolean;
        };
        [key: string]: any;
      }>;
      [key: string]: any;
    };
    [key: string]: any;
  }

  /**
   * Response structure for GetItems
   */
  export interface GetItemsResponse {
    ItemsResult?: {
      Items: Item[];
    };
    Errors?: Array<{
      Code: string;
      Message: string;
    }>;
  }

  /**
   * Response structure for SearchItems
   */
  export interface SearchItemsResponse {
    SearchResult?: {
      Items: Item[];
      TotalResultCount?: number;
      SearchURL?: string;
    };
    Errors?: Array<{
      Code: string;
      Message: string;
    }>;
  }

  /**
   * Get item information by ASIN
   */
  export function GetItems(
    commonParameters: CommonParameters,
    requestParameters: GetItemsParameters
  ): Promise<GetItemsResponse>;

  /**
   * Search for items using keywords
   */
  export function SearchItems(
    commonParameters: CommonParameters,
    requestParameters: SearchItemsParameters
  ): Promise<SearchItemsResponse>;

  /**
   * Get browse node information
   */
  export function GetBrowseNodes(
    commonParameters: CommonParameters,
    requestParameters: GetBrowseNodesParameters
  ): Promise<any>;

  /**
   * Get product variations
   */
  export function GetVariations(
    commonParameters: CommonParameters,
    requestParameters: GetVariationsParameters
  ): Promise<any>;
}
