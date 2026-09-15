import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewOutline } from '../src/plotReview.js';
import { defaultDocument, newId, parseDocument, serializeDocument } from '../src/plotDocument.js';
import { reviewMeasurements } from '../src/measurementImport.js';
const plot = positions => ({ ...defaultDocument(), points: positions.map(([x,y], i) => ({ id: newId(), label: String(i+1), position: {x,y} })) });

test('clockwise and counterclockwise concave outlines are both valid', () => {
  const doc = plot([[0,0],[100,0],[100,100],[50,45],[0,100]]);
  assert.equal(reviewOutline(doc).direction, 'clockwise'); assert.deepEqual(reviewOutline(doc).warnings, []);
  doc.points.reverse(); assert.equal(reviewOutline(doc).direction, 'counterclockwise'); assert.deepEqual(reviewOutline(doc).warnings, []);
});
test('crossed sequence identifies candidate endpoints without rearranging measurements', () => {
  const doc = plot([[0,0],[100,100],[0,100],[100,0]]), before = serializeDocument(doc);
  const review = reviewOutline(doc); assert.ok(review.warnings.some(w => w.kind === 'crossing'));
  assert.deepEqual(new Set(review.warnings[0].ids), new Set(doc.points.map(p=>p.id)));
  assert.equal(serializeDocument(doc), before);
  [doc.points[1],doc.points[2]]=[doc.points[2],doc.points[1]]; assert.deepEqual(reviewOutline(doc).warnings, []);
});
test('overlap, flat outlines, explicit direction and disabled checks are distinct', () => {
  assert.ok(reviewOutline(plot([[0,0],[100,0],[0,0]])).warnings.some(w=>w.kind==='overlap'));
  assert.ok(reviewOutline(plot([[0,0],[100,0],[200,0]])).warnings.some(w=>w.kind==='flat'));
  const doc = plot([[0,0],[100,0],[100,100],[0,100]]); doc.outlineDirection='counterclockwise';
  assert.equal(reviewOutline(doc).warnings[0].kind,'direction');
  doc.outlineDirection='off';assert.deepEqual(reviewOutline(doc).warnings,[]);
});
test('translated and scaled outlines keep the same review result', () => {
  const doc=plot([[0,0],[100,100],[0,100],[100,0]]);
  for(const p of doc.points){p.position.x=p.position.x*1e8+1e12;p.position.y=p.position.y*1e8-1e12;}
  assert.equal(reviewOutline(doc).warnings[0].kind,'crossing');
});
test('notes, remeasurement flags and walking direction survive portable JSON', () => {
  const doc=plot([[200,300]]);doc.points[0].note='Check B reading <near steps>';doc.points[0].needsRemeasure=true;
  doc.baselineNote='Move tape clear of ladder';doc.baselineNeedsRemeasure=true;doc.outlineDirection='clockwise';
  assert.deepEqual(parseDocument(serializeDocument(doc)),doc);
});
test('impossible A/B pairs explain which triangle constraint failed', () => {
  const doc=defaultDocument();
  const short=reviewMeasurements([{label:'P1',first:'0.2',second:'0.3'}],doc,{mode:'distances'});
  assert.match(short.rows[0].error,/added together are shorter/);
  const far=reviewMeasurements([{label:'P1',first:'5',second:'1'}],doc,{mode:'distances'});
  assert.match(far.rows[0].error,/difference.*longer/);
});
