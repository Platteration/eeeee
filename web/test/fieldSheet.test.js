import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toFieldSheetHtml } from '../src/fieldSheet.js';
import { defaultDocument } from '../src/plotDocument.js';

test('field sheets preserve point order, notes and baseline reminders with unit readings', () => {
  const doc = defaultDocument();
  doc.name = 'West pool';
  doc.baselineNeedsRemeasure = true;
  doc.baselineNote = 'Check tape sag\nUse north post';
  doc.points = [
    { id: 'second', label: '12', description: 'Deep-end corner', position: { x: 200, y: 300 }, needsRemeasure: true, note: 'Check from B\nWatch the ladder' },
    { id: 'first', label: '2', description: 'Steps 🏊', position: { x: 200, y: 500 } },
  ];
  const before = structuredClone(doc);
  const html = toFieldSheetHtml(doc);
  assert.match(html, /<h1>West pool<\/h1>/);
  assert.match(html, /A–B reference: 2\.000 m/);
  assert.match(html, /☐ Remeasure A–B/);
  assert.match(html, /Check tape sag\nUse north post/);
  assert.match(html, /<td>1<\/td><th scope="row">12/);
  assert.match(html, /<td>2<\/td><th scope="row">2/);
  assert.match(html, /1\.414/);
  assert.match(html, /☐ Remeasure\nCheck from B\nWatch the ladder/);
  assert.match(html, /Steps 🏊/);
  assert.deepEqual(doc, before);
});

test('field sheets escape all user text and never embed active content', () => {
  const doc = defaultDocument();
  doc.name = '<script>"Title"</script>';
  doc.baselineNote = '<img src=x onerror=alert(1)>';
  doc.points = [{ id: 'p', label: '<b>&', description: '</th><script>alert(1)</script>', note: '<iframe src="https://example.com">', position: { x: 0, y: 0 } }];
  const html = toFieldSheetHtml(doc);
  assert.doesNotMatch(html, /<(script|iframe|img)\b/);
  assert.match(html, /&lt;script&gt;&quot;Title&quot;&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;&amp;/);
  assert.match(html, /&lt;\/th&gt;&lt;script&gt;/);
});

test('field sheets identify outline checks and leave missing measurements blank', () => {
  const doc = defaultDocument();
  doc.abDistance = 0;
  doc.points = [[0,0],[100,100],[0,100],[100,0]].map(([x,y], index) => ({ id: String(index), label: String(index + 1), position: { x,y } }));
  const html = toFieldSheetHtml(doc);
  assert.match(html, /Check outline/);
  assert.match(html, /cross or touch/);
  assert.match(html, /class="distance">—/);
  assert.doesNotMatch(toFieldSheetHtml({ ...doc, outlineDirection: 'off' }), /Check outline|<h2>Outline checks/);
  assert.match(toFieldSheetHtml(defaultDocument()), /No points added yet/);
});
