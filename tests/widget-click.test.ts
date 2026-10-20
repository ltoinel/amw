/**
 * Behaviour test of the click beacon sent by src/widgets/widget.js
 *
 * jsdom 29 depends on ES modules that Jest's CommonJS runtime cannot load, so
 * the widget runs in a plain Node process and reports the beacons it sent.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const RUNNER = `
const fs = require('fs');
const { JSDOM } = require('jsdom');
const [widgetPath, id, events] = process.argv.slice(1);

const dom = new JSDOM('<!DOCTYPE html><html lang="en"><body><div class="amw"></div></body></html>', {
  url: 'https://blog.example/post',
  runScripts: 'outside-only'
});
const window = dom.window;
window.document.querySelector('.amw').id = id;
const beacons = [];
Object.defineProperty(window.navigator, 'sendBeacon', { value: url => { beacons.push(url); return true; } });
window.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
  title: 'Arduino Uno R3', url: 'https://www.amazon.fr/dp/B084DN3XVN', image: 'https://m.media-amazon.com/a.jpg',
  price: '24,99 €', timestamp: Date.now()
}) });
window.console.log = () => {};
window.console.warn = () => {};
window.eval(fs.readFileSync(widgetPath, 'utf8'));

setTimeout(() => {
  const link = window.document.querySelector('.amw-widget-main-link');
  // jsdom does not implement navigation
  link.addEventListener('click', event => event.preventDefault());
  for (const spec of JSON.parse(events)) {
    link.dispatchEvent(new window.MouseEvent(spec.type, { bubbles: true, cancelable: true, button: spec.button || 0 }));
  }
  process.stdout.write(JSON.stringify({ href: link.href, beacons }));
}, 20);
`;

function run(id: string, events: { type: string; button?: number }[]): { href: string; beacons: string[] } {
  const widgetPath = path.join(__dirname, '../src/widgets/widget.js');
  const output = execFileSync(process.execPath, ['-e', RUNNER, widgetPath, id, JSON.stringify(events)], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8'
  });
  return JSON.parse(output);
}

describe('Widget click beacon', () => {
  test('sends a beacon with the ASIN when the affiliate link is clicked', () => {
    const result = run('B084DN3XVN', [{ type: 'click' }]);
    expect(result.href).toBe('https://www.amazon.fr/dp/B084DN3XVN');
    expect(result.beacons).toEqual(['https://blog.example/item/click?id=B084DN3XVN']);
  });

  test('counts a middle click but not a right click', () => {
    const result = run('B084DN3XVN', [{ type: 'auxclick', button: 1 }, { type: 'auxclick', button: 2 }]);
    expect(result.beacons).toHaveLength(1);
  });

  test('does not send a beacon for an id that is not an ASIN', () => {
    expect(run('my-product', [{ type: 'click' }]).beacons).toEqual([]);
  });
});
