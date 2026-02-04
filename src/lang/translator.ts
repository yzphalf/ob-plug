import { en } from './en';
import { zh } from './zh';

// Define the shape of a translation map
type TranslationMap = { [key: string]: string };

// Object to hold all translations
const translations: { [key: string]: TranslationMap } = {
    en: en,
    zh: zh,
};

// Variable to hold the current language, default to English
let currentLanguage: string = 'en';

/**
 * Sets the current language for the translator.
 * @param lang The language code (e.g., 'en', 'zh').
 */
export function setLanguage(lang: string): void {
    currentLanguage = translations[lang] ? lang : 'en';
}

/**
 * Translates a given key into the currently set language.
 * Falls back to the key itself if the translation is not found.
 * @param key The key to translate.
 * @returns The translated string.
 */
export function t(key: string): string {
    const translation = translations[currentLanguage]?.[key];
    return translation || key;
}

/**
 * Returns the currently set language.
 * @returns The current language code (e.g., 'en', 'zh').
 */
export function getCurrentLanguage(): string {
    return currentLanguage;
}
