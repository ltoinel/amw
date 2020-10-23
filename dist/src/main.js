"use strict";
/**
 * MainAMW.
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */
Object.defineProperty(exports, "__esModule", { value: true });
// Set a default environment by default
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const AmwServer_1 = require("./server/AmwServer");
const amwServer = new AmwServer_1.AmwServer();
amwServer.start();
