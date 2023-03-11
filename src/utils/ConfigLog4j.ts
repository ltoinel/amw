/**
 * Logger configuration
 * ----------------------------------------------
 * Amazon Modern Widgets (AMW).
 *
 * @author : Ludovic Toinel <ludovic@toinel.com>
 * @src : https://github.com/ltoinel/amw
 */

import { LoggerFactory, LoggerFactoryOptions, LFService, LogGroupRule, LogLevel } from "typescript-logging";
import config from "config";

// Create options instance and specify 2 LogGroupRules:
// * One for any logger with a name starting with model, to log on debug
// * The second one for anything else to log on info

// Debug the API calls
const debug = config.get('Server.debug');

// Setup the logging options
const options = new LoggerFactoryOptions()

// If the debug is enabled, we log everything on debug
if (debug) {

    options.addLogGroupRule(new LogGroupRule(new RegExp("AmwServer"), LogLevel.Debug))
        .addLogGroupRule(new LogGroupRule(new RegExp("AmwApi"), LogLevel.Debug))
        .addLogGroupRule(new LogGroupRule(new RegExp("Paapi"), LogLevel.Debug))
        .addLogGroupRule(new LogGroupRule(new RegExp(".+"), LogLevel.Info));

} else {

     options.addLogGroupRule(new LogGroupRule(new RegExp("AmwServer"), LogLevel.Info))
        .addLogGroupRule(new LogGroupRule(new RegExp("AmwApi"), LogLevel.Info))
        .addLogGroupRule(new LogGroupRule(new RegExp("Paapi"), LogLevel.Info))
        .addLogGroupRule(new LogGroupRule(new RegExp(".+"), LogLevel.Info));
}


// Create a named loggerfactory and pass in the options and export the factory.
// Named is since version 0.2.+ (it's recommended for future usage)
export const Factory = LFService.createNamedLoggerFactory("LoggerFactory", options);