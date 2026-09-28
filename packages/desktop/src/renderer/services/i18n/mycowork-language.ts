/**
 * [mycowork] Default interface language (MyCowork D130 / PR11 audit B1).
 * Upstream resolves the first-run language from `navigator.language` (renderer `initLanguage`), so a headless or
 * English-locale browser gets an English UI even though the product is Chinese-first. MyCowork wants zh-CN unless the
 * user saved another language in settings; nothing else (browser locale, localStorage hint) is consulted.
 */
import { normalizeLanguageCode, type SupportedLanguage } from '@/common/config/i18n';

export const MYCOWORK_DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN';

/** The language to start with: the user's saved setting, otherwise the MyCowork default. */
export function startupLanguage(saved: string | null | undefined): SupportedLanguage {
  return normalizeLanguageCode(saved || MYCOWORK_DEFAULT_LANGUAGE);
}
