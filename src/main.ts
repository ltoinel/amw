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
import { loadSettings } from "./server/Settings";

const amwServer = new AmwServer(loadSettings());
// start() has already logged the cause; exiting avoids a second, unformatted unhandled-rejection trace
amwServer.start().catch(() => process.exit(1));
