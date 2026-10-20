#!/usr/bin/env node

/**
 * Build script for widgets
 * Minifies and copies widget files from src/widgets/ to dist/widgets/
 *
 * Each minified .js/.css file also gets a content-hashed copy (widget.<hash>.js) that the
 * server caches as immutable; manifest.json maps the stable names to the hashed ones.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');

const SRC_DIR = path.join(__dirname, '../src/widgets');
const DIST_DIR = path.join(__dirname, '../dist/widgets');
const MANIFEST_FILE = 'manifest.json';
// Must match the versioned route of the server (AmwServer)
const HASHED_FILE_PATTERN = /^[\w-]+\.[0-9a-f]{10}\.(js|css)$/;

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

/**
 * Writes `<name>.<hash><ext>` next to the stable file and returns its name.
 */
function writeHashedCopy(file, content) {
  const ext = path.extname(file);
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 10);
  const hashedFile = `${path.basename(file, ext)}.${hash}${ext}`;
  fs.writeFileSync(path.join(DIST_DIR, hashedFile), content);
  log(`    ✓ Versioned copy: ${hashedFile}`, colors.green);
  return hashedFile;
}

async function buildWidgets() {
  log('🔨 Building widgets...', colors.blue);
  
  try {
    // Create dist/widgets directory if it doesn't exist
    if (!fs.existsSync(DIST_DIR)) {
      fs.mkdirSync(DIST_DIR, { recursive: true });
      log(`✓ Created directory: ${DIST_DIR}`, colors.green);
    }
    
    // Hashed copies of a previous build (npm run build:widgets does not clean dist/)
    for (const file of fs.readdirSync(DIST_DIR)) {
      if (HASHED_FILE_PATTERN.test(file)) {
        fs.unlinkSync(path.join(DIST_DIR, file));
      }
    }

    // Stylesheets first: the script embeds the hashed name of widget.css
    const files = fs.readdirSync(SRC_DIR)
      .sort((a, b) => Number(path.extname(b) === '.css') - Number(path.extname(a) === '.css'));
    const manifest = {};

    for (const file of files) {
      const srcPath = path.join(SRC_DIR, file);
      const distPath = path.join(DIST_DIR, file);
      const ext = path.extname(file);
      
      log(`  Processing: ${file}`, colors.yellow);
      
      if (ext === '.js') {
        // Minify JavaScript
        let code = fs.readFileSync(srcPath, 'utf8');
        // Quoted references to built stylesheets ('widget.css') point to their immutable copy
        for (const [name, hashedName] of Object.entries(manifest)) {
          code = code.split(`'${name}'`).join(`'${hashedName}'`);
        }
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
        manifest[file] = writeHashedCopy(file, result.code);
        const originalSize = Buffer.byteLength(code, 'utf8');
        const minifiedSize = Buffer.byteLength(result.code, 'utf8');
        const reduction = ((1 - minifiedSize / originalSize) * 100).toFixed(1);
        log(`    ✓ Minified ${file}: ${originalSize} → ${minifiedSize} bytes (-${reduction}%)`, colors.green);
        
      } else if (ext === '.css') {
        // Level 1 only: whitespace and comment removal, without restructuring rules,
        // so the rendered widget stays exactly the same
        const css = fs.readFileSync(srcPath, 'utf8');
        const result = new CleanCSS({ level: 1 }).minify(css);
        if (result.errors.length > 0) {
          throw new Error(result.errors.join('\n'));
        }

        const minified = `/* Amazon Modern Widgets - https://github.com/ltoinel/amw */\n${result.styles}`;
        fs.writeFileSync(distPath, minified);
        manifest[file] = writeHashedCopy(file, minified);
        const originalSize = Buffer.byteLength(css, 'utf8');
        const minifiedSize = Buffer.byteLength(minified, 'utf8');
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
    
    fs.writeFileSync(path.join(DIST_DIR, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    log(`    ✓ Wrote ${MANIFEST_FILE}`, colors.green);

    log('✅ Widgets built successfully!', colors.green);
    
  } catch (error) {
    log(`❌ Error building widgets: ${error.message}`, colors.red);
    process.exit(1);
  }
}

buildWidgets();
