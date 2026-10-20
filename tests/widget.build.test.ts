/**
 * Checks on the minified widget produced by `npm run build:widgets` (dist/widgets/widget.js).
 * The widget behaviour itself is covered by widget.dom.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const sourcePath = path.join(__dirname, '../src/widgets/widget.js');
const distPath = path.join(__dirname, '../dist/widgets/widget.js');

describe('minified widget', () => {
  let source: string;
  let minified: string;

  beforeAll(() => {
    if (!fs.existsSync(distPath)) {
      throw new Error(`${distPath} is missing: run "npm run build" before the tests`);
    }
    source = fs.readFileSync(sourcePath, 'utf8');
    minified = fs.readFileSync(distPath, 'utf8');
  });

  it('is at least 30 % smaller than the source', () => {
    expect(minified.length).toBeLessThan(source.length * 0.7);
  });

  it('starts with the preamble and drops the JSDoc comments', () => {
    expect(minified).toMatch(/^\/\* Amazon Modern Widgets - https:\/\/github\.com\/ltoinel\/amw \*\//);
    expect(minified).not.toContain('/**');
  });

  it('is syntactically valid JavaScript', () => {
    expect(() => new Function(minified)).not.toThrow();
  });

  it('does not rely on eval or the Function constructor', () => {
    expect(minified).not.toMatch(/\beval\s*\(/);
    expect(minified).not.toMatch(/new\s+Function\s*\(/);
  });

  it('keeps the public AmwWidget API names that host pages call', () => {
    for (const name of ['AmwWidget', 'loadAllWidgets', 'setApiConfig', 'getCacheStats', 'clearCache']) {
      expect(minified).toContain(name);
    }
  });
});
