/**
 * Main AMW
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

// Set a default environment by default
process.env.NODE_ENV = process.env.NODE_ENV || "production";

// Import the main application
import { AmwServer } from "./server/AmwServer";

// Start the AMW Server
const amwServer = new AmwServer();
amwServer.start();
