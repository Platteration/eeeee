import { newId, UNITS, abDistanceMeters } from './plotDocument.js';
import { canvasPoint, hasValidBaseline } from './plotMath.js';
import { validateGeometry } from './validation.js';

/** Quoted CSV/TSV, semicolon-separated rows, or whitespace field notes. */
export function parseRows(text, { delimiter = 'auto', header = false, columns = [0, 1, 2] } = {}) {
  if (text.length > 100000) throw new Error('Paste at most 100,000 characters per import.');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (delimiter === 'auto') {
    const first = text.split('\n').find(line => line.trim()) ?? '';
    delimiter = first.includes('\t') ? '\t' : first.includes(';') ? ';' : first.includes(',') ? ',' : 'space';
  }
  let records = [];
  if (delimiter === 'space') records = text.split('\n').filter(line => line.trim()).map(line => line.trim().split(/\s+/));
  else {
    let record = [], field = '', quoted = false, afterQuote = false;
    for (let i = 0; i <= text.length; i++) {
      const c = text[i] ?? '\n';
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') { quoted = false; afterQuote = true; }
        else field += c;
      } else if (c === delimiter || c === '\n') {
        record.push(field.trim()); field = ''; afterQuote = false;
        if (c === '\n') { if (record.some(Boolean)) records.push(record); record = []; }
      } else if (c === '"' && !field.trim() && !afterQuote) { quoted = true; field = ''; }
      else if (afterQuote && !/\s/.test(c)) throw new Error('Unexpected text after a quoted field. Check the delimiter.');
      else field += c;
    }
    if (quoted) throw new Error('A quoted field is not closed.');
  }
  if (header) records = records.slice(1);
  if (records.length > 500) throw new Error('Import at most 500 rows at a time. Existing plots are not truncated.');
  if (!columns.every(n => Number.isSafeInteger(n) && n >= 0 && n < 30)) throw new Error('Choose column numbers between 1 and 30.');
  if (!records.length) throw new Error('No measurement rows found.');
  if (new Set(columns).size !== 3) throw new Error('Choose a different column for each field.');
  return records.map((fields, index) => ({ source: index + 1 + Number(header), label: fields[columns[0]] ?? '', first: fields[columns[1]] ?? '', second: fields[columns[2]] ?? '', side: 'above' }));
}

export function measurementNumber(text, decimal = '.') {
  text = String(text).trim().replace(/−/g, '-');
  const pattern = decimal === ',' ? /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/ : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!pattern.test(text)) throw new Error(`“${text}” is not a number with the selected decimal separator.`);
  const number = Number(text.replace(',', '.'));
  if (!Number.isFinite(number)) throw new Error('Measurement is outside the supported range.');
  return number;
}

export function reviewMeasurements(rows, doc, { mode = 'offsets', unit = doc.unit, decimal = '.', replace = false } = {}) {
  if (!Object.hasOwn(UNITS, unit)) throw new Error('Choose meters or feet.');
  if (!hasValidBaseline(doc.pointA, doc.pointB) || !(abDistanceMeters(doc) > 0)) throw new Error('Set a positive A–B distance and separate the baseline handles first.');
  const seen = new Set(['a', 'b', ...(replace ? [] : doc.points.map(p => p.label.toLowerCase()))]);
  const reviewed = rows.map(row => {
    try {
      const label = row.label.trim();
      if (!label || label.length > 40) throw new Error('Use a label between 1 and 40 characters.');
      if (seen.has(label.toLowerCase())) throw new Error('Duplicate or reserved label. Rename this point.');
      seen.add(label.toLowerCase());
      const first = measurementNumber(row.first, decimal) * UNITS[unit].toMeters;
      const second = measurementNumber(row.second, decimal) * UNITS[unit].toMeters;
      const baseline = abDistanceMeters(doc);
      let s = first / baseline, t = second / baseline;
      if (mode === 'distances') {
        if (first < 0 || second < 0) throw new Error('Distances from A and B cannot be negative.');
        if (s + t < 1 - 1e-12 || Math.abs(s - t) > 1 + 1e-12) throw new Error('These distances cannot form a triangle with A–B.');
        const along = (s * s - t * t + 1) / 2;
        const height = s * s - along * along;
        if (height < -1e-10) throw new Error('These distances cannot form a triangle with A–B.');
        t = Math.sqrt(Math.max(0, height)) * (row.side === 'below' ? 1 : -1); s = along;
      }
      if (![s, t].every(n => Number.isFinite(n) && Math.abs(n) <= 1e6)) throw new Error('Measurement exceeds one million baseline lengths.');
      const point = { id: row.id ?? newId(), label, position: canvasPoint({ s, t }, doc.pointA, doc.pointB) };
      validateGeometry({ ...doc, points: [point] });
      return { ...row, id: point.id, point, error: null };
    } catch (error) { return { ...row, point: null, error: error.message }; }
  });
  return { rows: reviewed, document: { ...doc, points: [...(replace ? [] : doc.points), ...reviewed.filter(r => r.point).map(r => r.point)] }, valid: reviewed.length > 0 && reviewed.every(r => !r.error) };
}
