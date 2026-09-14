/**
 * Wiring: the store owns the plot, the editor draws it, this module keeps the
 * panel, the keyboard and the file buttons in step with both.
 */

import { Store } from './store.js';
import { PlotEditor } from './editor.js';
import { changeUnit, createPoint, defaultDocument, fileStem, parseDocument, UNITS } from './plotDocument.js';
import {
  isMeasurable,
  measurePoints,
  metersPerCanvasUnit,
  plotExtent,
  positionForOffsets,
} from './measurements.js';
import { formatLength, formatSigned, toMeters } from './format.js';
import { canvasABLength } from './plotMath.js';
import { downloadCsv, downloadJson, downloadPng, downloadSvg, planContentSize } from './exporters.js';
import { drawingArea, fitScale, formatScale } from './paper.js';

const $ = (id) => document.getElementById(id);

const ui = {
  canvas: $('canvas'),
  undo: $('undo'),
  redo: $('redo'),
  fit: $('fit'),
  zoomIn: $('zoom-in'),
  zoomOut: $('zoom-out'),
  name: $('name'),
  distance: $('ab-distance'),
  unit: $('unit'),
  scaleNote: $('scale-note'),
  tableHead: document.querySelector('#measurements thead'),
  tableBody: document.querySelector('#measurements tbody'),
  pointsEmpty: $('points-empty'),
  extentNote: $('extent-note'),
  add: $('add'),
  clear: $('clear'),
  importButton: $('import'),
  file: $('file'),
  annotate: $('annotate'),
  sheet: $('sheet'),
  planScale: $('plan-scale'),
  sheetNote: $('sheet-note'),
  exportJson: $('export-json'),
  exportCsv: $('export-csv'),
  exportSvg: $('export-svg'),
  exportPng: $('export-png'),
  reset: $('reset'),
  status: $('status'),
  saveStatus: $('save-status'),
  retrySave: $('retry-save'),
  recovery: $('recovery'),
  readout: $('readout'),
  scaleBar: $('scale-bar'),
  scaleBarRule: document.querySelector('.scale-bar-rule'),
  scaleBarLabel: $('scale-bar-label'),
  emptyHint: $('empty-hint'),
};

/**
 * `localStorage` is not just empty but *throwing* in a browser set to block
 * site data. Access it without writing a probe so a full store can still be
 * read and recovered. The store reports read/write failures in the Plot panel.
 */
function availableStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const storage = availableStorage();
const store = Store.fromStorage(storage);

/**
 * Preferences about *output* rather than about the plot, kept apart from the
 * document so what gets exported stays byte-compatible with the iOS app.
 */
const PREFERENCES_KEY = 'abplot.web.preferences.v1';
const preferences = { annotateExports: false, sheet: '', planScale: '', ...readPreferences() };

function readPreferences() {
  try {
    return JSON.parse(storage?.getItem(PREFERENCES_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function writePreferences() {
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Same as the plot itself: unable to remember is not unable to work.
  }
}
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
  if (document.activeElement !== ui.name) ui.name.value = doc.name ?? '';
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
    `Switching units converts the distance and keeps the same physical scale.`;
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
    // Read "1,5" as 1.5: the app writes a decimal point, but a comma is what
    // half the world's keyboards and tape measures say.
    const typed = Number(entered.replace(',', '.'));
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
  ui.saveStatus.textContent = store.saveError ?? (store.hasSaved
    ? 'Saved in this browser. Export JSON for a portable backup.' : 'Autosave ready. Export JSON for a portable backup.');
  ui.saveStatus.dataset.tone = store.saveError ? 'error' : 'ok';
  ui.retrySave.hidden = !store.saveError;
  ui.retrySave.textContent = store.needsRecovery ? 'Replace previous autosave…' : 'Retry save';
  ui.recovery.hidden = store.recoveryText === null;
  renderScale(doc);
  renderTable(doc);
  ui.undo.disabled = !store.canUndo;
  ui.redo.disabled = !store.canRedo;
  renderSheetNote();
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
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a plot JSON file smaller than 5 MB');
    loadDocument(parseDocument(await file.text()), `Imported ${file.name}. Undo restores the previous plot.`);
  } catch (error) {
    setStatus(`Could not import ${file.name}: ${error.message}`, 'error');
  }
}

/* ---------------------------------------------------------------- binding */

ui.name.addEventListener('input', () => {
  const name = ui.name.value;
  store.apply((draft) => {
    draft.name = name;
  });
});

ui.distance.addEventListener('input', () => {
  // A number input reports '' for anything it cannot parse -- including a
  // half-typed value -- and Number('') is 0, which would quietly unscale the
  // plot. Leave the document alone until the field says something meaningful.
  const entered = ui.distance.value.trim();
  const value = Number(entered);
  if (entered === '' || !Number.isFinite(value) || value < 0) return;
  store.apply((draft) => {
    draft.abDistance = value;
  });
});

// Leaving the field puts back what the plot actually uses, so a rejected entry
// cannot sit there looking as though it took.
ui.distance.addEventListener('blur', () => {
  ui.distance.value = String(store.document.abDistance);
});

ui.unit.addEventListener('change', () => {
  const unit = ui.unit.value;
  try { store.apply((draft) => changeUnit(draft, unit)); }
  catch (error) { renderScale(store.document); setStatus(error.message, 'error'); }
});

ui.retrySave.addEventListener('click', () => {
  if (store.needsRecovery && !window.confirm('Replace the unreadable previous autosave with the current plot? Download its recovery copy first if you need to keep it.')) return;
  store.retrySaving(availableStorage(), { replaceUnreadable: true });
});
ui.recovery.addEventListener('click', () => {
  if (store.recoveryText === null) return;
  const url = URL.createObjectURL(new Blob([store.recoveryText], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'plot-recovery.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  setStatus('Recovery download requested. When you have saved it, choose Replace previous autosave to resume saving.');
});

ui.undo.addEventListener('click', () => store.undo());
ui.redo.addEventListener('click', () => store.redo());
ui.fit.addEventListener('click', () => editor.fit());
ui.zoomIn.addEventListener('click', () => editor.zoomBy(1.3));
ui.zoomOut.addEventListener('click', () => editor.zoomBy(1 / 1.3));

ui.add.addEventListener('click', () => {
  // Selected, unlike a click on the canvas: the point was asked for rather than
  // aimed at, so the next thing wanted is to type where it actually goes.
  const point = createPoint(editor.viewCenter, store.document.points);
  store.apply((draft) => draft.points.push(point));
  store.select(point.id);
  setStatus(`Added point ${point.label} — type its Along and Perp. to place it.`);
});

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

/** Exported files are named after the plot, so a folder of them stays legible. */
const exportName = (suffix) => `${fileStem(store.document)}${suffix}`;

ui.exportJson.addEventListener('click', () => {
  const filename = exportName('.json');
  downloadJson(store.document, filename);
  setStatus(`Exported ${filename}. In the updated iOS app, choose Plot files & name → Open plot JSON.`);
});
ui.exportCsv.addEventListener('click', () => {
  const filename = exportName('-measurements.csv');
  downloadCsv(store.document, filename);
  setStatus(`Exported ${filename}.`);
});
/**
 * How the plan exports should be laid out: fitted to a pixel width, or on a
 * real sheet at a true scale. The sheet select carries paper and orientation
 * together, since nobody thinks of them separately.
 */
function planOptions() {
  const [paper, orientation] = preferences.sheet.split('-');
  return {
    annotate: preferences.annotateExports,
    paper: paper || null,
    orientation: orientation ?? 'landscape',
    scale: preferences.planScale ? Number(preferences.planScale) : null,
  };
}

ui.exportSvg.addEventListener('click', () => {
  const filename = exportName('.svg');
  downloadSvg(store.document, { ...planOptions(), filename });
  setStatus(`Exported ${filename}.`);
});
ui.exportPng.addEventListener('click', async () => {
  const filename = exportName('.png');
  try {
    await downloadPng(store.document, { ...planOptions(), filename });
    setStatus(`Exported ${filename}.`);
  } catch (error) {
    setStatus(`Could not export the PNG: ${error.message}`, 'error');
  }
});

ui.annotate.checked = preferences.annotateExports;
ui.annotate.addEventListener('change', () => {
  preferences.annotateExports = ui.annotate.checked;
  writePreferences();
});

ui.sheet.value = preferences.sheet;
ui.planScale.value = preferences.planScale;
for (const [element, key] of [
  [ui.sheet, 'sheet'],
  [ui.planScale, 'planScale'],
]) {
  element.addEventListener('change', () => {
    preferences[key] = element.value;
    writePreferences();
    renderSheetNote();
  });
}

/**
 * Say what the next plan export will actually be — which scale, and whether
 * the plot fits on the chosen sheet — rather than letting the file be the
 * first place that turns up.
 */
function renderSheetNote() {
  const options = planOptions();
  ui.planScale.disabled = !options.paper;
  if (!options.paper) {
    ui.sheetNote.textContent = 'Plans are sized to fit their content. Pick a sheet to draw at a true scale.';
    return;
  }
  // The renderer's own idea of how much ground the plan covers, so the note
  // cannot promise a scale the export will not use.
  const content = planContentSize(store.document, options);
  if (!content) {
    ui.sheetNote.textContent = 'Set a distance and a baseline to draw the plan to scale.';
    return;
  }
  const largest = fitScale(content, drawingArea(options.paper, options.orientation));
  if (options.scale) {
    const fits = largest !== null && options.scale >= largest;
    ui.sheetNote.textContent = fits
      ? `Drawn at ${formatScale(options.scale)}: 1 m on the ground is ${(1000 / options.scale).toFixed(1)} mm on the page.`
      : `The plot is too big for this sheet at ${formatScale(options.scale)}` +
        `${largest === null ? '' : ` — ${formatScale(largest)} would fit`}.`;
    return;
  }
  ui.sheetNote.textContent =
    largest === null
      ? 'The plot is too big for this sheet at any standard scale; the plan will be fitted instead.'
      : `Drawn at ${formatScale(largest)}, the largest standard scale that fits this sheet.`;
}

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
