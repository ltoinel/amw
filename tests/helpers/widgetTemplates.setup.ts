/**
 * The widget tests load src/widgets/widget.js as written, where the build has not inlined the
 * card templates yet: they get them as the global the source reads instead.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readTemplates } = require('../../scripts/widget-templates');

(globalThis as Record<string, unknown>).AMW_CARD_TEMPLATES = readTemplates();
