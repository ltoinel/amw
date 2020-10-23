"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Factory = void 0;
const typescript_logging_1 = require("typescript-logging");
// Create options instance and specify 2 LogGroupRules:
// * One for any logger with a name starting with model, to log on debug
// * The second one for anything else to log on info
const options = new typescript_logging_1.LoggerFactoryOptions()
    .addLogGroupRule(new typescript_logging_1.LogGroupRule(new RegExp("AmwServer"), typescript_logging_1.LogLevel.Debug))
    .addLogGroupRule(new typescript_logging_1.LogGroupRule(new RegExp("AmwApi"), typescript_logging_1.LogLevel.Debug))
    .addLogGroupRule(new typescript_logging_1.LogGroupRule(new RegExp("Paapi"), typescript_logging_1.LogLevel.Debug))
    .addLogGroupRule(new typescript_logging_1.LogGroupRule(new RegExp(".+"), typescript_logging_1.LogLevel.Info));
// Create a named loggerfactory and pass in the options and export the factory.
// Named is since version 0.2.+ (it's recommended for future usage)
exports.Factory = typescript_logging_1.LFService.createNamedLoggerFactory("LoggerFactory", options);
