/**
 * [mycowork] D130 / PR11 audit B1: the interface starts in zh-CN unless the user saved another language. Upstream's renderer
 * `initLanguage` fell back to `navigator.language`, so a headless or English-locale browser got an English UI; the saved
 * setting still wins and unknown codes normalize as before.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MYCOWORK_DEFAULT_LANGUAGE, startupLanguage } from '@/renderer/services/i18n/mycowork-language';

describe('default interface language (D130)', () => {
  it('starts in zh-CN without a saved setting; a saved setting wins; codes normalize', () => {
    expect(MYCOWORK_DEFAULT_LANGUAGE).toBe('zh-CN');
    expect(startupLanguage(undefined)).toBe('zh-CN');
    expect(startupLanguage(null)).toBe('zh-CN');
    expect(startupLanguage('')).toBe('zh-CN');
    expect(startupLanguage('en-US')).toBe('en-US');
    expect(startupLanguage('ja')).toBe('ja-JP');
  });

  it('the renderer no longer consults navigator.language when nothing is saved', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../packages/desktop/src/renderer/services/i18n/index.ts'),
      'utf8'
    );
    const body = src.slice(src.indexOf('async function initLanguage'), src.indexOf('// Listen for language changes'));
    expect(body).not.toContain('navigator.language');
    expect(body).toContain('startupLanguage(');
  });
});
