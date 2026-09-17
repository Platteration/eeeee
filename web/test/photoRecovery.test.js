import test from 'node:test';
import assert from 'node:assert/strict';
import { staleRecoveries } from '../src/photoRecovery.js';

const record = (id, updated, project) => ({ id, project, updated, name: 'Pool', text: '{}' });
const records = [record('r1', 1, 'r1'), record('r2', 2, 'r1'), record('r3', 3, 'r1'), record('r4', 4, 'r1'), record('other', 5, 'other'), { id: 'legacy', updated: 6, name: 'Old', text: '{}' }];

test('a new recovery copy makes only its own project\'s older copies beyond the keep count stale', () => {
  assert.deepEqual(staleRecoveries(records, { project: 'r1', keep: 2, protect: ['r4'] }), ['r1']);
  assert.deepEqual(staleRecoveries(records, { project: 'r1', keep: 0, protect: ['r4'] }), ['r3', 'r2', 'r1']);
  assert.deepEqual(staleRecoveries(records, { project: 'other', keep: 2, protect: [] }), []);
});
test('the copy the current document points at is never stale, even when it is the oldest', () => {
  assert.deepEqual(staleRecoveries(records, { project: 'r1', keep: 1, protect: ['r4', 'r1'] }), ['r2']);
  assert.deepEqual(staleRecoveries(records, { project: 'r1', keep: 0, protect: ['r4', 'r1', undefined] }), ['r3', 'r2']);
});
test('copies written before projects were tracked form their own project', () => {
  assert.deepEqual(staleRecoveries(records, { project: 'legacy', keep: 1, protect: ['new'] }), []);
  assert.deepEqual(staleRecoveries(records, { project: 'legacy', keep: 0, protect: ['new'] }), ['legacy']);
});
