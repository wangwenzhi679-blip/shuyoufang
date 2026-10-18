export const defaultPreferences = Object.freeze({
  theme: 'light',
  interfaceSize: 'standard',
  readingSize: 16,
  startPage: 'home',
  restoreReading: true,
  defaultModel: 'configured',
  imageModel: 'configured',
  answerStyle: 'moderate',
});
export const interfacePixels = { small: 13, standard: 14, large: 16 };
export function normalizePreferences(value = {}) {
  return Object.fromEntries(
    Object.entries(defaultPreferences).map(([key, fallback]) => [key, value[key] ?? fallback]),
  );
}
