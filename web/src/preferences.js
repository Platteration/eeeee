export const PREFERENCES_KEY = 'abplot.web.preferences.v1';
export function readPreferences(storage) {
  let raw;
  try { raw = JSON.parse(storage?.getItem(PREFERENCES_KEY) ?? '{}'); } catch { /* defaults */ }
  const sheets = ['', 'a4-landscape', 'a4-portrait', 'a3-landscape', 'a3-portrait', 'letter-landscape', 'letter-portrait', 'tabloid-landscape'];
  return {
    annotateExports: raw?.annotateExports === true,
    sheet: sheets.includes(raw?.sheet) ? raw.sheet : '',
    planScale: ['', '20', '50', '100', '200', '500', '1000'].includes(raw?.planScale) ? raw.planScale : '',
  };
}
