#!/usr/bin/env node

/**
 * Build script for widgets
 * Minifies and copies widget files from src/widgets/ to dist/widgets/
 */

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { minify: minifyHtml } = require('html-minifier-terser');

const SRC_DIR = path.join(__dirname, '../src/widgets');
const DIST_DIR = path.join(__dirname, '../dist/widgets');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function buildWidgets() {
  log('🔨 Building widgets...', colors.blue);
  
  try {
    // Create dist/widgets directory if it doesn't exist
    if (!fs.existsSync(DIST_DIR)) {
      fs.mkdirSync(DIST_DIR, { recursive: true });
      log(`✓ Created directory: ${DIST_DIR}`, colors.green);
    }
    
    // Read all files in src/widgets
    const files = fs.readdirSync(SRC_DIR);
    
    for (const file of files) {
      const srcPath = path.join(SRC_DIR, file);
      const distPath = path.join(DIST_DIR, file);
      const ext = path.extname(file);
      
      log(`  Processing: ${file}`, colors.yellow);
      
      if (ext === '.js') {
        // Minify JavaScript
        const code = fs.readFileSync(srcPath, 'utf8');
        const result = await minify(code, {
          compress: {
            dead_code: true,
            drop_console: false,
            drop_debugger: true,
            keep_classnames: true,
            keep_fnames: false,
            passes: 2
          },
          mangle: {
            keep_classnames: true,
            keep_fnames: false
          },
          format: {
            comments: false,
            preamble: '/* Amazon Modern Widgets - https://github.com/ltoinel/amw */'
          }
        });
        
        if (result.error) {
          throw result.error;
        }
        
        fs.writeFileSync(distPath, result.code);
        const originalSize = Buffer.byteLength(code, 'utf8');
        const minifiedSize = Buffer.byteLength(result.code, 'utf8');
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
        log(`    ✓ Minified ${file}: ${originalSize} → ${minifiedSize} bytes (-${reduction}%)`, colors.green);
        
      } else if (ext === '.html') {
        // Minify HTML
        const html = fs.readFileSync(srcPath, 'utf8');
        const minified = await minifyHtml(html, {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          removeScriptTypeAttributes: true,
          removeStyleLinkTypeAttributes: true,
          useShortDoctype: true,
          minifyCSS: true,
          minifyJS: true
        });
        
        fs.writeFileSync(distPath, minified);
        const originalSize = Buffer.byteLength(html, 'utf8');
        const minifiedSize = Buffer.byteLength(minified, 'utf8');
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
        log(`    ✓ Minified ${file}: ${originalSize} → ${minifiedSize} bytes (-${reduction}%)`, colors.green);
        
      } else {
        // Copy other files as-is
        fs.copyFileSync(srcPath, distPath);
        log(`    ✓ Copied ${file}`, colors.green);
      }
    }
    
    log('✅ Widgets built successfully!', colors.green);
    
  } catch (error) {
    log(`❌ Error building widgets: ${error.message}`, colors.red);
    process.exit(1);
  }
}

buildWidgets();
