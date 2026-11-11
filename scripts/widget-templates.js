/**
 * The card templates of the widget (src/widgets/templates/<name>.html), inlined into widget.js by
 * the build so that a card needs no extra request. Shared by the build and the widget tests.
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../src/widgets/templates');
// Must match TEMPLATE_NAME in src/widgets/widget.js: the name is chosen by data-amw-template
const TEMPLATE_NAME = /^[a-z][a-z0-9-]{0,31}$/;
// The expression of widget.js the build replaces with the templates
const TEMPLATES_MARKER = '/* @amw-templates */ (window.AMW_CARD_TEMPLATES || {})';

/** The templates by name, as written, without their comments. */
function readTemplates(dir = TEMPLATES_DIR) {
  const templates = {};
  for (const file of fs.readdirSync(dir).sort()) {
    const name = path.basename(file, '.html');
    if (path.extname(file) !== '.html') continue;
    if (!TEMPLATE_NAME.test(name)) {
      throw new Error(`Invalid template name: ${file} (lowercase letters, digits and dashes)`);
    }
    templates[name] = fs.readFileSync(path.join(dir, file), 'utf8').replace(/<!--[\s\S]*?-->/g, '').trim();
  }
  if (!templates.default) {
    throw new Error(`${dir}/default.html is missing: it is the template of every card by default`);
  }
  return templates;
}

module.exports = { readTemplates, TEMPLATES_DIR, TEMPLATES_MARKER };
