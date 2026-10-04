import { createRequire } from 'node:module';
import { buildShortcodeTable } from '../shared/emoji';

const require = createRequire(import.meta.url);

/** GitHub shortcodes (the ones Slack and GitHub users already know) mapped to emoji, loaded once at startup. */
export const SHORTCODES = buildShortcodeTable(require('emojibase-data/en/compact.json'), require('emojibase-data/en/shortcodes/github.json'));
