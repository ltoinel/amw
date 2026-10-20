/**
 * Entry point.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

// Must be set before the first import of `config`, which reads NODE_ENV once to pick the YAML file
process.env.NODE_ENV = process.env.NODE_ENV || "production";

import { AmwServer } from "./server/AmwServer";

const amwServer = new AmwServer();
amwServer.start();
