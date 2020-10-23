"use strict";
/**
 * Main Server Class
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
exports.AmwServer = void 0;
// Lets import our required libraries
const config_1 = __importDefault(require("config"));
const express_1 = __importDefault(require("express"));
const ConfigLog4j_1 = require("../utils/ConfigLog4j");
const AmwApi_1 = require("./AmwApi");
/**
 * AMW Server Class
 */
class AmwServer {
    /**
     * Main AmwServer constructor.
     */
    constructor() {
        this.RELEASE = "1.4.0";
        this.PORT = config_1.default.get('Server.port');
        this.RELATIVE_PATH = config_1.default.get('Server.path');
        // Initialize the logger
        this.log = ConfigLog4j_1.Factory.getLogger("AmwServer");
        // Initialize the express server
        this.app = express_1.default();
        // Create a new API instance
        this.api = new AmwApi_1.AmwApi();
        // Returns a product description in JSON.
        this.app.get(this.RELATIVE_PATH + '/product', (req, res) => this.api.setProductEndpoint(req, res));
        // Returns a product HTML Card.
        this.app.get(this.RELATIVE_PATH + '/card', (req, res) => this.api.setCardEndpoint(req, res));
    }
    ;
    /**
     * Start the Webserver
     */
    start() {
        // Listen on the defined port, 8080 by default.
        this.app.listen(this.PORT, () => {
            this.log.info(`AMW ${this.RELEASE} is listening on port ${this.PORT} ...`);
            this.log.info(`Loading ${process.env.NODE_ENV} settings`);
            this.log.info(`Debug is ${config_1.default.get('Server.debug')}`);
        });
    }
}
exports.AmwServer = AmwServer;
