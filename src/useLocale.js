import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_LOCALE, LOCALES, normalizeLocale, translate } from './i18n.js';

const storageKey = 'game-ui-studio.locale';
function initialLocale() {
  try { return normalizeLocale(localStorage.getItem(storageKey)); }
  catch { return DEFAULT_LOCALE; }
}

export function useLocale() {
  const [locale, updateLocale] = useState(initialLocale);
  const [preferenceError, setPreferenceError] = useState(false);
  const [ready, setReady] = useState(false);
  const chosen = useRef(false);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    fetch('/api/preferences', { signal: AbortSignal.timeout(5000) }).then(response => {
      if (!response.ok) throw new Error('Preference load failed');
      return response.json();
    }).then(value => {
      if (active && !chosen.current && LOCALES.includes(value.locale)) updateLocale(value.locale);
    }).catch(() => { if (active) setPreferenceError(true); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    try { localStorage.setItem(storageKey, locale); } catch { /* Server persistence remains available. */ }
  }, [locale]);
  const setLocale = useCallback(value => {
    if (!LOCALES.includes(value)) return;
    chosen.current = true;
    updateLocale(value);
    // Serialize rapid toggles so the last chosen language also wins on disk.
    writes.current = writes.current.catch(() => {}).then(async () => {
      const response = await fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: value }) });
      if (!response.ok) throw new Error('Preference save failed');
      setPreferenceError(false);
    }).catch(() => setPreferenceError(true));
  }, []);
  const t = useCallback((key, values) => translate(locale, key, values), [locale]);
  return { locale, setLocale, t, preferenceError, ready };
}
