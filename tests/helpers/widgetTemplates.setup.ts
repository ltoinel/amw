/**
 * The widget tests load src/widgets/widget.js as written, where the build has not inlined the
 * card templates yet: they get them as the global the source reads instead.
 */
 
const { readTemplates } = require('../../scripts/widget-templates');

(globalThis as Record<string, unknown>).AMW_CARD_TEMPLATES = readTemplates();
