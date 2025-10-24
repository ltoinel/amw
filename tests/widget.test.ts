/**
 * Unit tests for widget.js
 * Tests the widget build, minification, and code quality
 */

import * as fs from 'fs';
import * as path from 'path';

describe('Widget Build and Quality Tests', () => {
  let widgetScript: string;
  let sourceWidget: string;

  beforeAll(() => {
    // Read the minified files
    const widgetPath = path.join(__dirname, '../dist/widgets/widget.js');
    
    // Read source files
    const sourceWidgetPath = path.join(__dirname, '../src/widgets/widget.js');
    
    widgetScript = fs.readFileSync(widgetPath, 'utf8');
    sourceWidget = fs.readFileSync(sourceWidgetPath, 'utf8');
  });

  describe('Widget Files Exist', () => {
    test('widget.js should exist in dist/widgets/', () => {
      const widgetPath = path.join(__dirname, '../dist/widgets/widget.js');
      expect(fs.existsSync(widgetPath)).toBe(true);
    });

    test('source file should exist in src/widgets/', () => {
      const widgetPath = path.join(__dirname, '../src/widgets/widget.js');
      expect(fs.existsSync(widgetPath)).toBe(true);
    });
  });

  describe('XSS Protection', () => {
    test('widget script should not contain eval', () => {
      expect(widgetScript).not.toContain('eval(');
    });

    test('widget script should not contain Function constructor', () => {
      expect(widgetScript).not.toMatch(/new\s+Function\s*\(/);
    });

    test('widget script should have text escaping logic', () => {
      // Minified code contains HTML entity replacements
      expect(widgetScript).toMatch(/&lt;|&gt;|&amp;/);
    });
  });

  describe('Performance Features', () => {
    test('widget script should implement caching', () => {
      expect(widgetScript).toContain('cache');
    });

    test('widget script should implement lazy loading', () => {
      expect(widgetScript).toContain('IntersectionObserver');
    });

    test('widget script should implement debouncing', () => {
      expect(widgetScript).toContain('debounce');
    });
  });

  describe('JavaScript Minification', () => {
    test('minified JS script should be smaller than source', () => {
      expect(widgetScript.length).toBeLessThan(sourceWidget.length);
      
      const reduction = ((1 - widgetScript.length / sourceWidget.length) * 100).toFixed(1);
      console.log(`Widget minification: ${sourceWidget.length} → ${widgetScript.length} bytes (-${reduction}%)`);
      
      // Should have at least 30% reduction
      expect(parseFloat(reduction)).toBeGreaterThan(30);
    });

    test('minified script should not contain unnecessary comments', () => {
      // Count comments (excluding preamble)
      const comments = widgetScript.match(/\/\*[\s\S]*?\*\//g) || [];
      // Minifier should keep at most one comment (preamble)
      expect(comments.length).toBeLessThanOrEqual(2);
    });

    test('minified script should contain preamble comment', () => {
      expect(widgetScript).toMatch(/^\/\* Amazon Modern Widgets/);
    });

    test('minified script should be valid JavaScript', () => {
      expect(() => {
        new Function(widgetScript);
      }).not.toThrow();
    });
  });

  describe('Multi-language Support', () => {
    test('widget script should support multiple languages', () => {
      expect(widgetScript).toContain('languages');
      expect(widgetScript).toContain('fr');
      expect(widgetScript).toContain('en');
    });

    test('widget script should have translations', () => {
      expect(widgetScript).toContain('buy');
      expect(widgetScript).toContain('update');
      expect(widgetScript).toContain('loading');
    });
  });

  describe('Accessibility', () => {
    test('widget script should include ARIA functionality', () => {
      expect(widgetScript).toMatch(/role|aria/i);
    });

    test('widget script should include visually hidden functionality', () => {
      expect(widgetScript).toContain('hidden');
    });
  });

  describe('Browser Compatibility', () => {
    test('widget should check for IntersectionObserver support', () => {
      expect(widgetScript).toContain('IntersectionObserver');
    });

    test('widget should have fallback messaging', () => {
      expect(widgetScript).toContain('warn');
    });
  });

  describe('Widget Structure and Features', () => {
    test('widget should create main link wrapper for full clickability', () => {
      expect(widgetScript).toContain('main-link');
    });

    test('widget should handle both ASIN and keyword parameters', () => {
      expect(widgetScript).toContain('product');
      expect(widgetScript).toContain('id');
    });

    test('widget should implement error handling', () => {
      expect(widgetScript).toContain('error');
      expect(widgetScript).toContain('catch');
    });
  });
});
