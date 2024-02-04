/**
 * Logger configuration
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { LogLevel } from "typescript-logging";
import { Log4TSProvider, Logger } from "typescript-logging-log4ts-style";
import config from "config";

// Debug the API calls
var defaultLogLevel: LogLevel = LogLevel.Info

// If the debug is enabled, we log everything on debug
if (config.get('Server.debug')) {
    defaultLogLevel = LogLevel.Debug;
}

const provider = Log4TSProvider.createProvider("AMW", {

    groups: [
        {
            expression: new RegExp("AmwServer"),
            level: defaultLogLevel,
        },
        {
            expression: new RegExp("AmwApi"),
            level: defaultLogLevel,
        },
        {
            expression: new RegExp("Paapi"),
            level: defaultLogLevel,
        },
        {
            expression: new RegExp(".+"),
            level: LogLevel.Info,
        },
    ]
});

export function getLogger(name: string): Logger {
    return provider.getLogger(name);
}