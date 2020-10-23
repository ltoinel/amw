"use strict";
/**
 * API Implementation.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AmwApi = void 0;
// Lets import our required libraries
const config_1 = __importDefault(require("config"));
const path_1 = __importDefault(require("path"));
const Paapi_1 = require("./Paapi");
const express_redis_cache_1 = require("express-redis-cache");
const ConfigLog4j_1 = require("../utils/ConfigLog4j");
/**
 * API Implementation.
 */
class AmwApi {
    /**
     * Main AmwServer constructor.
     */
    constructor() {
        // Is cached enabled ?
        this.CACHE_ENABLED = config_1.default.get('Redis.enabled');
        this.PROJECT_DIR = config_1.default.get('Server.projectDir');
        // Initialize the logger
        this.log = ConfigLog4j_1.Factory.getLogger("AmwApi");
        // If redis cache is enabled
        if (this.CACHE_ENABLED) {
            this.cache = new express_redis_cache_1.ExpressRedisCache({
                host: config_1.default.get('Redis.host'),
                port: config_1.default.get('Redis.port'),
                auth_pass: config_1.default.get('Redis.password'),
                expire: config_1.default.get('Redis.expire')
            });
        }
        ;
        // Initialize the Paapi client
        this.paapi = new Paapi_1.Paapi();
    }
    ;
    /**
     * Set the product API Endpoint.
     */
    setProductEndpoint(req, res) {
        // Debug
        this.log.info(`GET /product?id=${req.query.id}&keyword=${req.query.keyword}`);
        // If the cache is enabled we use it
        if (this.CACHE_ENABLED && this.cache !== undefined)
            this.cache.route();
        // We get the product or search it
        if (req.query.id) {
            // We get the Item information on Amazon API
            this.paapi.getItemApi(req.query.id).then(product => this.returnResponse(product, req, res));
        }
        else if (req.query.keyword) {
            // We search the Item information on Amazon API
            this.paapi.searchItemApi(req.query.keyword).then(product => this.returnResponse(product, req, res));
        }
    }
    returnResponse(product, req, res) {
        // We return the result only if it has been found
        if (product !== undefined) {
            this.log.info("Product found");
            res.json(product);
            return;
        }
        else {
            this.log.warn(`Product not found : ${req.query.id} | ${req.query.keyword}`);
            res.json("Not found");
            return;
        }
    }
    /**
     * Set the API Card endpoint.
     */
    setCardEndpoint(req, res) {
        this.log.info(`GET /card?id=${req.query.id}&keyword=${req.query.keyword}`);
        res.sendFile(path_1.default.join(this.PROJECT_DIR + '/resources/html/card.html'));
    }
}
exports.AmwApi = AmwApi;
