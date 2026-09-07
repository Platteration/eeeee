/**
 * Wiring: the store owns the plot, the editor draws it, this module keeps the
 * panel, the keyboard and the file buttons in step with both.
 */

import { Store } from './store.js';
import { PlotEditor } from './editor.js';
import { defaultDocument, parseDocument, UNITS } from './plotDocument.js';
import {
  isMeasurable,
  measurePoints,
  metersPerCanvasUnit,
  plotExtent,
  positionForOffsets,
} from './measurements.js';
import { formatLength, formatSigned, toMeters } from './format.js';
import { canvasABLength } from './plotMath.js';
import { downloadCsv, downloadJson, downloadPng, downloadSvg } from './exporters.js';

const $ = (id) => document.getElementById(id);

const ui = {
  canvas: $('canvas'),
  undo: $('undo'),
  redo: $('redo'),
  fit: $('fit'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  distance: $('ab-distance'),
  unit: $('unit'),
  scaleNote: $('scale-note'),
  tableHead: document.querySelector('#measurements thead'),
  tableBody: document.querySelector('#measurements tbody'),
  pointsEmpty: $('points-empty'),
  extentNote: $('extent-note'),
  clear: $('clear'),
  importButton: $('import'),
  file: $('file'),
  exportJson: $('export-json'),
  exportCsv: $('export-csv'),
  exportSvg: $('export-svg'),
  exportPng: $('export-png'),
  reset: $('reset'),
  status: $('status'),
  readout: $('readout'),
  scaleBar: $('scale-bar'),
  scaleBarRule: document.querySelector('.scale-bar-rule'),
  scaleBarLabel: $('scale-bar-label'),
  emptyHint: $('empty-hint'),
};

/**
 * `localStorage` is not just empty but *throwing* in a browser set to block
 * site data, so probe it before handing it to the store; without it the app
 * still works, it simply forgets the plot between visits.
 */
function availableStorage() {
  try {
    const probe = '__abplot_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = Store.fromStorage(availableStorage());
const editor = new PlotEditor(ui.canvas, store);

let statusTimer = 0;
function setStatus(message, tone = 'ok') {
  ui.status.textContent = message;
  ui.status.dataset.tone = tone;
  clearTimeout(statusTimer);
  // Errors stay until the next action; confirmations fade so the panel stays calm.
  if (message && tone === 'ok') statusTimer = setTimeout(() => (ui.status.textContent = ''), 6000);
}

/* ------------------------------------------------------------------ panel */

function renderScale(doc) {
  if (document.activeElement !== ui.distance) ui.distance.value = String(doc.abDistance);
  ui.unit.value = doc.unit;

  const symbol = UNITS[doc.unit].symbol;
  if (!isMeasurable(doc)) {
    ui.scaleNote.textContent =
      doc.abDistance > 0
        ? 'A and B are on top of each other — drag them apart to define the baseline.'
        : 'Enter the real-world distance between A and B to scale the plot.';
    return;
  }
  const perUnit = metersPerCanvasUnit(doc);
  const unitsPerOne = 1 / (perUnit / UNITS[doc.unit].toMeters);
  ui.scaleNote.textContent =
    `1 ${symbol} = ${unitsPerOne.toFixed(1)} canvas units · baseline ${canvasABLength(doc.pointA, doc.pointB).toFixed(0)} units. ` +
    `Switching unit reinterprets the number rather than converting it.`;
}

/**
 * Columns of the measurement table. The last one only exists while a point is
 * selected: measuring the rest of the plot against one chosen point is the
 * question a tape measure answers on site.
 */
function columnsFor(selected) {
  const columns = [
    {
      key: 'along',
      head: 'Along',
      signed: true,
      editable: true,
      title: 'Distance along the A→B baseline — type to place the point exactly',
    },
    {
      key: 'perp',
      head: 'Perp.',
      signed: true,
      editable: true,
      title:
        'Distance perpendicular to the baseline, positive on the canvas-down side — ' +
        'type to place the point exactly',
    },
    { key: 'fromA', head: 'From A', title: 'Straight-line distance from A' },
    { key: 'fromB', head: 'From B', title: 'Straight-line distance from B' },
  ];
  if (selected) {
    columns.push({
      key: 'fromReference',
      head: `From ${selected.label}`,
      title: `Straight-line distance from the selected point ${selected.label}`,
    });
  }
  return columns;
}

function renderHead(columns) {
  const tr = document.createElement('tr');
  const first = document.createElement('th');
  first.scope = 'col';
  first.textContent = '#';
  tr.append(first);
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column.head;
    th.title = column.title;
    tr.append(th);
  }
  const actions = document.createElement('th');
  actions.scope = 'col';
  actions.innerHTML = '<span class="visually-hidden">Actions</span>';
  tr.append(actions);
  ui.tableHead.replaceChildren(tr);
}

/**
 * Which cell the user is in, so a re-render can put them back. Every edit
 * rebuilds the table, and typing into an element that is about to be replaced
 * would otherwise drop focus mid-keystroke.
 */
function captureTableFocus() {
  const active = document.activeElement;
  if (!active || !ui.tableBody.contains(active) || !active.dataset.row) return null;
  return {
    row: active.dataset.row,
    column: active.dataset.column,
    start: active.selectionStart,
    end: active.selectionEnd,
  };
}

function restoreTableFocus(focus) {
  if (!focus) return;
  const input = ui.tableBody.querySelector(
    `[data-row="${CSS.escape(focus.row)}"][data-column="${CSS.escape(focus.column)}"]`,
  );
  if (!input) return;
  input.focus();
  if (focus.start !== null) input.setSelectionRange(focus.start, focus.end);
}

/** An editable measurement cell: type a distance, the point moves there. */
function measureInput(row, column, text) {
  const input = document.createElement('input');
  input.className = 'measure-input';
  input.dataset.row = row.id;
  input.dataset.column = column.key;
  input.value = text;
  input.inputMode = 'decimal';
  input.setAttribute('aria-label', `${column.head} for point ${row.label}`);
  input.addEventListener('change', () => {
    const entered = input.value.trim();
    const typed = Number(entered);
    if (entered === '' || !Number.isFinite(typed)) {
      // Put the old value back rather than moving the point somewhere arbitrary.
      input.value = text;
      setStatus(`“${entered}” is not a distance.`, 'error');
      return;
    }
    moveTo(row, column.key, typed);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = text;
      input.blur();
    }
    event.stopPropagation();
  });
  return input;
}

/** Move a point so that its `along` or `perp` reads `value` in the doc's unit. */
function moveTo(row, key, value) {
  const doc = store.document;
  const offsets = { along: row.along, perp: row.perp, [key]: toMeters(value, doc.unit) };
  const position = positionForOffsets(doc, offsets);
  if (!position) return;
  store.apply((draft) => {
    const point = draft.points.find((p) => p.id === row.id);
    if (point) point.position = position;
  });
}

function renderTable(doc) {
  const selected = store.selectedPoint;
  const rows = measurePoints(doc, selected ? selected.position : null);
  const columns = columnsFor(selected);
  const measurable = isMeasurable(doc);
  const focus = captureTableFocus();
  renderHead(columns);

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.tabIndex = 0;
    if (row.id === store.selectedId) tr.setAttribute('aria-selected', 'true');

    const labelCell = document.createElement('td');
    const input = document.createElement('input');
    input.className = 'label-input';
    input.dataset.row = row.id;
    input.dataset.column = 'label';
    input.value = row.label;
    input.setAttribute('aria-label', `Label for point ${row.label}`);
    // 'change' (not 'input') so re-rendering never yanks the caret mid-typing.
    input.addEventListener('change', () => {
      const label = input.value.trim() || row.label;
      store.apply((draft) => {
        const point = draft.points.find((p) => p.id === row.id);
        if (point) point.label = label;
      });
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
      event.stopPropagation();
    });
    labelCell.append(input);
    tr.append(labelCell);

    for (const column of columns) {
      const td = document.createElement('td');
      const value = row[column.key];
      const text = column.signed
        ? formatSigned(value, doc.unit, { withUnit: false })
        : formatLength(value, doc.unit, { withUnit: false });
      // `along` and `perp` together *are* the point's position, so they can be
      // typed as well as read: enter what the tape says and the point moves
      // there. The derived distances stay read-only -- no single one of them
      // determines where a point is.
      if (column.editable && measurable) td.append(measureInput(row, column, text));
      else td.textContent = text;
      tr.append(td);
    }

    const actions = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'row-delete';
    remove.textContent = '✕';
    remove.title = `Delete point ${row.label}`;
    remove.setAttribute('aria-label', `Delete point ${row.label}`);
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      deletePoint(row.id);
    });
    actions.append(remove);
    tr.append(actions);

    tr.addEventListener('click', (event) => {
      // Clicking into a cell's input is editing, not selecting.
      if (event.target.closest('input, button')) return;
      store.select(row.id === store.selectedId ? null : row.id);
    });
    tr.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        store.select(row.id);
      }
    });
    fragment.append(tr);
  }

  ui.tableBody.replaceChildren(fragment);
  restoreTableFocus(focus);
  ui.pointsEmpty.hidden = rows.length > 0;
  ui.emptyHint.hidden = rows.length > 0;

  const extent = plotExtent(doc);
  const unitSymbol = UNITS[doc.unit].symbol;
  ui.extentNote.textContent = extent
    ? `Distances in ${unitSymbol}. Plot covers ${formatLength(extent.along, doc.unit, { withUnit: false })} × ` +
      `${formatLength(extent.perp, doc.unit, { withUnit: false })} ${unitSymbol} (along × across the baseline).`
    : `Distances in ${unitSymbol}, measured from the A–B baseline.`;
}

function renderScaleBar(bar) {
  ui.scaleBar.hidden = bar === null;
  if (!bar) return;
  ui.scaleBarRule.style.width = `${bar.pixels}px`;
  ui.scaleBarLabel.textContent = bar.label;
}

function render() {
  const doc = store.document;
  renderScale(doc);
  renderTable(doc);
  ui.undo.disabled = !store.canUndo;
  ui.redo.disabled = !store.canRedo;
  renderScaleBar(editor.scaleBar());
}

/* ---------------------------------------------------------------- actions */

function deletePoint(id) {
  const point = store.document.points.find((p) => p.id === id);
  if (!point) return;
  if (store.selectedId === id) store.select(null);
  store.apply((draft) => {
    draft.points = draft.points.filter((p) => p.id !== id);
  });
  setStatus(`Deleted point ${point.label}. Ctrl+Z to undo.`);
}

function loadDocument(doc, message) {
  store.replace(doc);
  editor.fit();
  setStatus(message);
}

async function importFile(file) {
  if (!file) return;
  try {
    loadDocument(parseDocument(await file.text()), `Imported ${file.name}.`);
  } catch (error) {
    setStatus(`Could not import ${file.name}: ${error.message}`, 'error');
  }
}

/* ---------------------------------------------------------------- binding */

ui.distance.addEventListener('input', () => {
  const value = Number(ui.distance.value);
  if (!Number.isFinite(value) || value < 0) return;
  store.apply((draft) => {
    draft.abDistance = value;
  });
});

ui.unit.addEventListener('change', () => {
  const unit = ui.unit.value;
  store.apply((draft) => {
    draft.unit = unit;
  });
});

ui.undo.addEventListener('click', () => store.undo());
ui.redo.addEventListener('click', () => store.redo());
ui.fit.addEventListener('click', () => editor.fit());
ui.zoomIn.addEventListener('click', () => editor.zoomBy(1.3));
ui.zoomOut.addEventListener('click', () => editor.zoomBy(1 / 1.3));

ui.clear.addEventListener('click', () => {
  const count = store.document.points.length;
  if (count === 0) return;
  store.select(null);
  store.apply((draft) => {
    draft.points = [];
  });
  setStatus(`Cleared ${count} point${count === 1 ? '' : 's'}. Ctrl+Z to undo.`);
});

ui.reset.addEventListener('click', () => loadDocument(defaultDocument(), 'Started a new plot. Ctrl+Z to undo.'));

ui.importButton.addEventListener('click', () => ui.file.click());
ui.file.addEventListener('change', async () => {
  await importFile(ui.file.files[0]);
  ui.file.value = '';
});

ui.exportJson.addEventListener('click', () => {
  downloadJson(store.document);
  setStatus('Exported plot.json — open it in the iOS app to place it in AR.');
});
ui.exportCsv.addEventListener('click', () => {
  downloadCsv(store.document);
  setStatus('Exported plot-measurements.csv.');
});
ui.exportSvg.addEventListener('click', () => {
  downloadSvg(store.document);
  setStatus('Exported plot.svg.');
});
ui.exportPng.addEventListener('click', async () => {
  try {
    await downloadPng(store.document);
    setStatus('Exported plot.png.');
  } catch (error) {
    setStatus(`Could not export the PNG: ${error.message}`, 'error');
  }
});

for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, (event) => {
    if (![...event.dataTransfer.types].includes('Files')) return;
    event.preventDefault();
    if (type === 'drop') importFile(event.dataTransfer.files[0]);
  });
}

document.addEventListener('keydown', (event) => {
  const target = event.target;
  const typing = target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);

  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) store.redo();
    else store.undo();
    return;
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    store.redo();
    return;
  }
  if (typing) return;

  const selected = store.selectedPoint;
  switch (event.key) {
    case 'Escape':
      store.select(null);
      break;
    case 'Delete':
    case 'Backspace':
      if (selected) {
        event.preventDefault();
        deletePoint(selected.id);
      }
      break;
    case 'f':
    case 'F':
      editor.fit();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!selected) return;
      event.preventDefault();
      // Nudge in screen pixels so the step feels the same at any zoom.
      const step = (event.shiftKey ? 10 : 1) * editor.unitsPerPixel;
      const dx = (event.key === 'ArrowRight') - (event.key === 'ArrowLeft');
      const dy = (event.key === 'ArrowDown') - (event.key === 'ArrowUp');
      store.apply((draft) => {
        const point = draft.points.find((p) => p.id === selected.id);
        if (point) point.position = { x: point.position.x + dx * step, y: point.position.y + dy * step };
      });
      break;
    }
    default:
      break;
  }
});

editor.addEventListener('hover', (event) => {
  const detail = event.detail;
  ui.readout.textContent = detail
    ? `along ${formatSigned(detail.along, detail.unit)} · across ${formatSigned(detail.perp, detail.unit)}`
    : '';
});
editor.addEventListener('viewchange', (event) => renderScaleBar(event.detail));

store.subscribe(render);
render();
editor.fit();

// Handy in the console, and how the smoke tests drive the app.
window.abplot = { store, editor };
