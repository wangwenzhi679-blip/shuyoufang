import { defaultPreferences, interfacePixels } from '../../shared/account-preferences.mjs';
export let activePreferences = { ...defaultPreferences };
const listeners = new Set();
export function applyPreferences(value) {
  activePreferences = { ...defaultPreferences, ...value };
  const root = document.documentElement;
  root.dataset.userTheme =
    activePreferences.theme === 'system'
      ? matchMedia('(prefers-color-scheme:dark)').matches
        ? 'dark'
        : 'light'
      : activePreferences.theme;
  root.dataset.interfaceSize = activePreferences.interfaceSize;
  root.style.setProperty('--user-ui-size', `${interfacePixels[activePreferences.interfaceSize]}px`);
  root.style.setProperty('--user-reading-size', `${activePreferences.readingSize}px`);
  for (const fn of listeners) fn(activePreferences);
}
export function listenPreferences(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const guards = new Set();
export function registerAccountGuard(fn) {
  guards.add(fn);
  return () => guards.delete(fn);
}
export async function saveBeforeAccountChange() {
  for (const fn of [...guards]) await fn();
}
