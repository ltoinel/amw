/**
 * Unit tests of the logger factory and its Server.debug driven log level.
 */

import { LogLevel } from 'typescript-logging';
import { mockConfig } from './helpers/mocks';

function loadGetLogger(debug: boolean) {
  jest.resetModules();
  mockConfig({ 'Server.debug': debug });
  return require('../src/utils/ConfigLog4j').getLogger as typeof import('../src/utils/ConfigLog4j').getLogger;
}

describe('getLogger', () => {
  it.each(['AmwServer', 'AmwApi', 'Paapi'])('logs %s at debug level when Server.debug is enabled', (name) => {
    expect(loadGetLogger(true)(name).logLevel).toBe(LogLevel.Debug);
  });

  it.each(['AmwServer', 'AmwApi', 'Paapi'])('logs %s at info level when Server.debug is disabled', (name) => {
    expect(loadGetLogger(false)(name).logLevel).toBe(LogLevel.Info);
  });

  it('keeps other loggers at info level even in debug mode', () => {
    expect(loadGetLogger(true)('ThirdParty').logLevel).toBe(LogLevel.Info);
  });
});
