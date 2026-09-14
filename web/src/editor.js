/**
 * The plot canvas: an SVG view of the document with pan, zoom, a real-world
 * grid, and pointer editing.
 *
 * The view transform lives entirely in the SVG `viewBox`, so nothing about
 * panning or zooming touches the document -- canvas coordinates stay exactly
 * what the phone would store. Everything the user sees at a constant size
 * (dots, handles, stroke widths) is drawn in canvas units scaled by
 * {@link PlotEditor#unitsPerPixel}, which is what keeps a 12 px dot 12 px at
 * every zoom level.
 */

import { abCoordinates, hasValidBaseline } from './plotMath.js';
import { abDistanceMeters, createPoint } from './plotDocument.js';
import { isMeasurable, metersPerCanvasUnit } from './measurements.js';
import { abGrid } from './grid.js';
import { formatCompact, formatLength, fromMeters, niceStep } from './format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Pointer travel (CSS px) that turns a click into a drag or a pan. */
const DRAG_THRESHOLD = 4;
/** Minimum on-screen spacing (CSS px) between grid lines. */
const MIN_GRID_SPACING = 32;
const POINT_RADIUS = 12;
const HANDLE_RADIUS = 15;
const MIN_UNITS_PER_PIXEL = 0.02;
const MAX_UNITS_PER_PIXEL = 200;

function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(name, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

export class PlotEditor extends EventTarget {
  #svg;
  #store;
  #layers;
  #view = { cx: 200, cy: 400, unitsPerPixel: 1 };
  #gesture = null;
  /** Live pointers, so a second finger can turn a drag into a pinch. */
  #pointers = new Map();
  #pinch = null;

  constructor(svg, store) {
    super();
    this.#svg = svg;
    this.#store = store;

    this.#layers = {
      grid: el('g', { 'data-layer': 'grid' }),
      baseline: el('g', { 'data-layer': 'baseline' }),
      points: el('g', { 'data-layer': 'points' }),
      handles: el('g', { 'data-layer': 'handles' }),
    };
    for (const layer of Object.values(this.#layers)) svg.append(layer);

    svg.addEventListener('pointerdown', this.#onPointerDown);
    svg.addEventListener('pointermove', this.#onPointerMove);
    svg.addEventListener('pointerup', this.#onPointerUp);
    svg.addEventListener('pointercancel', this.#onPointerCancel);
    svg.addEventListener('lostpointercapture', this.#onPointerCancel);
    svg.addEventListener('pointerleave', this.#onPointerLeave);
    svg.addEventListener('wheel', this.#onWheel, { passive: false });
    svg.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('blur', () => this.finishGesture());
    window.addEventListener('pagehide', () => this.finishGesture());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.finishGesture();
    });

    store.subscribe(() => this.render());
    new ResizeObserver(() => this.render()).observe(svg);
  }

  /** Canvas units per CSS pixel -- the zoom level, and the unit of "screen size". */
  get unitsPerPixel() {
    return this.#view.unitsPerPixel;
  }

  /** The canvas point at the middle of the view: where to put something the
   *  user asked for without pointing at a spot. */
  get viewCenter() {
    return { x: this.#view.cx, y: this.#view.cy };
  }

  #size() {
    const rect = this.#svg.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
  }

  /** The current viewBox, derived from the element's size so it never letterboxes. */
  #viewBox() {
    const { width, height } = this.#size();
    const w = width * this.#view.unitsPerPixel;
    const h = height * this.#view.unitsPerPixel;
    return { x: this.#view.cx - w / 2, y: this.#view.cy - h / 2, w, h };
  }

  #toCanvas(event) {
    const rect = this.#svg.getBoundingClientRect();
    const box = this.#viewBox();
    return {
      x: box.x + ((event.clientX - rect.left) / Math.max(rect.width, 1)) * box.w,
      y: box.y + ((event.clientY - rect.top) / Math.max(rect.height, 1)) * box.h,
    };
  }

  /** Frame the whole plot with a comfortable margin. */
  fit() {
    const doc = this.#store.document;
    const xs = [doc.pointA.x, doc.pointB.x, ...doc.points.map((p) => p.position.x)];
    const ys = [doc.pointA.y, doc.pointB.y, ...doc.points.map((p) => p.position.y)];
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const { width, height } = this.#size();
    // A margin in canvas units proportional to the content, with a floor so a
    // single point or a perfectly straight plot still gets breathing room.
    const margin = Math.max((maxX - minX) * 0.15, (maxY - minY) * 0.15, 60);
    const spanX = maxX - minX + margin * 2;
    const spanY = maxY - minY + margin * 2;
    this.#view.cx = (minX + maxX) / 2;
    this.#view.cy = (minY + maxY) / 2;
    this.#setZoom(Math.max(spanX / width, spanY / height));
    this.render();
  }

  /** Zoom by `factor` about the view centre (or about `focus` in canvas units). */
  zoomBy(factor, focus = null) {
    const anchor = focus ?? { x: this.#view.cx, y: this.#view.cy };
    const before = this.#view.unitsPerPixel;
    this.#setZoom(before / factor);
    const applied = before / this.#view.unitsPerPixel;
    // Keep `anchor` under the same pixel: pull the centre toward it by the
    // fraction of the distance the zoom just removed.
    this.#view.cx = anchor.x + (this.#view.cx - anchor.x) / applied;
    this.#view.cy = anchor.y + (this.#view.cy - anchor.y) / applied;
    this.render();
  }

  #setZoom(unitsPerPixel) {
    this.#view.unitsPerPixel = Math.min(MAX_UNITS_PER_PIXEL, Math.max(MIN_UNITS_PER_PIXEL, unitsPerPixel));
  }

  #onWheel = (event) => {
    event.preventDefault();
    // deltaY arrives in pixels, lines or pages depending on the browser and the
    // device; normalize to pixels, then clamp so one flick is not one leap.
    const perUnit = [1, 16, this.#size().height][event.deltaMode] ?? 1;
    const pixels = Math.max(-120, Math.min(120, event.deltaY * perUnit));
    this.zoomBy(Math.exp(-pixels / 400), this.#toCanvas(event));
  };

  #onPointerDown = (event) => {
    if (event.button !== 0 && event.button !== 1) return;
    this.#pointers.set(event.pointerId, event);
    // A third finger neither starts a second gesture nor disturbs the pinch.
    if (this.#pinch) return;
    if (this.#pointers.size === 2) {
      this.#beginPinch();
      return;
    }
    const target = event.target.closest?.('[data-role]');
    const role = target?.dataset.role;
    const start = this.#toCanvas(event);
    this.#capture(event.pointerId);

    if (event.button === 1 || event.shiftKey || !role) {
      this.#gesture = { kind: 'background', pointerId: event.pointerId, start, moved: false,
        panOnly: event.button === 1 || event.shiftKey };
      return;
    }

    if (role === 'point') {
      const id = target.dataset.id;
      const point = this.#store.document.points.find((p) => p.id === id);
      if (!point) return;
      const wasSelected = this.#store.selectedId === id;
      this.#store.select(id);
      this.#store.begin();
      this.#gesture = {
        kind: 'point',
        pointerId: event.pointerId,
        id,
        wasSelected,
        moved: false,
        start,
        offset: { x: point.position.x - start.x, y: point.position.y - start.y },
      };
      return;
    }

    if (role === 'handle') {
      const which = target.dataset.handle;
      const anchor = which === 'A' ? this.#store.document.pointA : this.#store.document.pointB;
      this.#store.begin();
      this.#gesture = {
        kind: 'handle',
        pointerId: event.pointerId,
        which,
        moved: false,
        start,
        offset: { x: anchor.x - start.x, y: anchor.y - start.y },
      };
    }
  };

  #onPointerMove = (event) => {
    if (this.#pointers.has(event.pointerId)) this.#pointers.set(event.pointerId, event);
    if (this.#pinch) {
      this.#updatePinch();
      return;
    }
    const here = this.#toCanvas(event);
    this.dispatchEvent(new CustomEvent('hover', { detail: this.#describe(here) }));

    const gesture = this.#gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;

    if (!gesture.moved) {
      const travelled = Math.hypot(here.x - gesture.start.x, here.y - gesture.start.y);
      if (travelled < DRAG_THRESHOLD * this.#view.unitsPerPixel) return;
      gesture.moved = true;
    }

    if (gesture.kind === 'background') {
      // `here` is measured against the current view, so shifting the centre by
      // the pointer's travel pins the canvas point the gesture started on back
      // under the cursor -- exact every frame, with nothing to accumulate.
      this.#view.cx -= here.x - gesture.start.x;
      this.#view.cy -= here.y - gesture.start.y;
      this.render();
      return;
    }

    const position = { x: here.x + gesture.offset.x, y: here.y + gesture.offset.y };
    if (gesture.kind === 'point') {
      this.#store.mutate((draft) => {
        const point = draft.points.find((p) => p.id === gesture.id);
        if (point) point.position = position;
      });
    } else {
      this.#store.mutate((draft) => {
        if (gesture.which === 'A') draft.pointA = position;
        else draft.pointB = position;
      });
    }
  };

  #onPointerUp = (event) => {
    this.#pointers.delete(event.pointerId);
    if (this.#pinch) {
      // Lifting either pinching finger ends the pinch; the other does not
      // become a drag, having never gone through pointerdown on its own.
      if (this.#pinch.ids.includes(event.pointerId)) this.#pinch = null;
      if (this.#svg.hasPointerCapture(event.pointerId)) this.#svg.releasePointerCapture(event.pointerId);
      return;
    }
    const gesture = this.#gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    this.#gesture = null;
    if (this.#svg.hasPointerCapture(event.pointerId)) this.#svg.releasePointerCapture(event.pointerId);

    if (gesture.kind === 'background') {
      if (gesture.moved || gesture.panOnly) return;
      // A click on empty canvas: deselect if something is selected, otherwise
      // add a point -- the same rule the iOS editor uses for a tap.
      if (this.#store.selectedId !== null) {
        this.#store.select(null);
      } else {
        // Deliberately not selected: leaving the new point unselected is what
        // lets the next click add another one rather than deselect this one.
        const point = createPoint(this.#toCanvas(event), this.#store.document.points);
        this.#store.apply((draft) => draft.points.push(point));
      }
      return;
    }

    this.#store.end();
    if (!gesture.moved && gesture.kind === 'point' && gesture.wasSelected) this.#store.select(null);
  };

  /** Finish a move without interpreting interruption as a tap or deselection. */
  finishGesture() {
    const ids = [...this.#pointers.keys()];
    this.#gesture = null;
    this.#pinch = null;
    this.#pointers.clear();
    this.#store.end();
    for (const id of ids) {
      if (this.#svg.hasPointerCapture(id)) this.#svg.releasePointerCapture(id);
    }
  }

  #onPointerCancel = (event) => {
    if (this.#pointers.has(event.pointerId)) this.finishGesture();
  };

  /**
   * Two fingers down: zoom by how far they spread, and keep whatever was
   * between them at the start pinned between them as they move.
   */
  #beginPinch() {
    // A drag in progress becomes a completed edit rather than being abandoned.
    if (this.#gesture && this.#gesture.kind !== 'background') this.#store.end();
    this.#gesture = null;
    const [first, second] = [...this.#pointers.values()];
    this.#pinch = {
      ids: [first.pointerId, second.pointerId],
      distance: Math.max(Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY), 1),
      unitsPerPixel: this.#view.unitsPerPixel,
      anchor: this.#toCanvas(this.#midpoint(first, second)),
    };
  }

  /**
   * Route the rest of the gesture to the SVG whatever it passes over, so
   * re-rendering the element under the cursor cannot interrupt a drag.
   * Capture is best-effort: a pointer can already be gone by the time we ask.
   */
  #capture(pointerId) {
    try {
      this.#svg.setPointerCapture(pointerId);
    } catch {
      // The pointer ended before capture; the gesture simply runs uncaptured.
    }
  }

  #midpoint(first, second) {
    return { clientX: (first.clientX + second.clientX) / 2, clientY: (first.clientY + second.clientY) / 2 };
  }

  #updatePinch() {
    // Always the two fingers the pinch started with, so a third one touching
    // down or lifting cannot make the plot jump.
    const [first, second] = this.#pinch.ids.map((id) => this.#pointers.get(id));
    if (!first || !second) return;
    const distance = Math.max(Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY), 1);
    this.#setZoom((this.#pinch.unitsPerPixel * this.#pinch.distance) / distance);

    // Place the centre so the anchor sits under the fingers' current midpoint.
    const rect = this.#svg.getBoundingClientRect();
    const mid = this.#midpoint(first, second);
    const px = this.#view.unitsPerPixel;
    this.#view.cx = this.#pinch.anchor.x - (mid.clientX - rect.left - rect.width / 2) * px;
    this.#view.cy = this.#pinch.anchor.y - (mid.clientY - rect.top - rect.height / 2) * px;
    this.render();
  }

  #onPointerLeave = () => {
    if (!this.#gesture) this.dispatchEvent(new CustomEvent('hover', { detail: null }));
  };

  /** Real-world description of a canvas position, for the cursor readout. */
  #describe(position) {
    const doc = this.#store.document;
    if (!isMeasurable(doc)) return null;
    const ab = abCoordinates(position, doc.pointA, doc.pointB);
    if (!ab) return null;
    const abMeters = abDistanceMeters(doc);
    return { along: ab.s * abMeters, perp: ab.t * abMeters, unit: doc.unit };
  }

  render() {
    const doc = this.#store.document;
    const box = this.#viewBox();
    this.#svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.w} ${box.h}`);
    const px = this.#view.unitsPerPixel;

    this.#renderGrid(doc, box, px);
    this.#renderBaseline(doc, px);
    this.#renderPoints(doc, px);
    this.#renderHandles(doc, px);
    this.dispatchEvent(new CustomEvent('viewchange', { detail: this.scaleBar() }));
  }

  /**
   * A scale bar for the current zoom: a round real-world length and how wide it
   * is on screen. Null when the plot has no scale to speak of.
   */
  scaleBar() {
    const doc = this.#store.document;
    const scale = metersPerCanvasUnit(doc);
    if (scale === null) return null;
    const metersPerPixel = scale * this.#view.unitsPerPixel;
    const meters = niceStep(80 * metersPerPixel);
    return {
      meters,
      pixels: meters / metersPerPixel,
      label: `${formatCompact(fromMeters(meters, doc.unit))} ${doc.unit === 'feet' ? 'ft' : 'm'}`,
    };
  }

  #renderGrid(doc, box, px) {
    const layer = this.#layers.grid;
    layer.replaceChildren();
    const grid = abGrid(doc, box, MIN_GRID_SPACING * px);
    if (!grid) return;

    for (const line of grid.lines) {
      layer.append(
        el('line', {
          x1: line.x1,
          y1: line.y1,
          x2: line.x2,
          y2: line.y2,
          class: line.axis ? 'grid-line grid-axis' : 'grid-line',
          'stroke-width': (line.axis ? 1.4 : 0.8) * px,
        }),
      );
    }
  }

  #renderBaseline(doc, px) {
    const layer = this.#layers.baseline;
    layer.replaceChildren();
    if (!hasValidBaseline(doc.pointA, doc.pointB)) return;

    layer.append(
      el('line', {
        x1: doc.pointA.x,
        y1: doc.pointA.y,
        x2: doc.pointB.x,
        y2: doc.pointB.y,
        class: 'baseline',
        'stroke-width': 2 * px,
        'stroke-dasharray': `${6 * px} ${4 * px}`,
      }),
    );

    const mid = { x: (doc.pointA.x + doc.pointB.x) / 2, y: (doc.pointA.y + doc.pointB.y) / 2 };
    let angle = (Math.atan2(doc.pointB.y - doc.pointA.y, doc.pointB.x - doc.pointA.x) * 180) / Math.PI;
    // Keep the label upright rather than reading it upside down.
    if (angle > 90 || angle < -90) angle += 180;
    const label = el(
      'text',
      {
        x: mid.x,
        y: mid.y,
        class: 'baseline-label',
        'font-size': 13 * px,
        'text-anchor': 'middle',
        transform: `rotate(${angle} ${mid.x} ${mid.y}) translate(0 ${-8 * px})`,
      },
      formatLength(abDistanceMeters(doc), doc.unit),
    );
    layer.append(label);
  }

  #renderPoints(doc, px) {
    const layer = this.#layers.points;
    layer.replaceChildren();
    const r = POINT_RADIUS * px;
    for (const point of doc.points) {
      const selected = point.id === this.#store.selectedId;
      const group = el('g', {
        'data-role': 'point',
        'data-id': point.id,
        class: selected ? 'point selected' : 'point',
      });
      group.append(el('circle', { cx: point.position.x, cy: point.position.y, r: 22 * px,
        fill: 'transparent', 'pointer-events': 'all', 'data-hit-target': '' }));
      group.append(el('circle', { cx: point.position.x, cy: point.position.y, r, class: 'point-dot' }));
      group.append(
        el('circle', {
          cx: point.position.x,
          cy: point.position.y,
          r,
          class: 'point-ring',
          'stroke-width': (selected ? 3 : 1.5) * px,
        }),
      );
      group.append(
        el(
          'text',
          {
            x: point.position.x,
            y: point.position.y,
            class: 'point-label',
            'font-size': 11 * px,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          },
          point.label,
        ),
      );
      layer.append(group);
    }
  }

  #renderHandles(doc, px) {
    const layer = this.#layers.handles;
    layer.replaceChildren();
    const r = HANDLE_RADIUS * px;
    for (const [name, position] of [
      ['A', doc.pointA],
      ['B', doc.pointB],
    ]) {
      const group = el('g', { 'data-role': 'handle', 'data-handle': name, class: `handle handle-${name}` });
      group.append(el('circle', { cx: position.x, cy: position.y, r: 22 * px,
        fill: 'transparent', 'pointer-events': 'all', 'data-hit-target': '' }));
      group.append(el('circle', { cx: position.x, cy: position.y, r, class: 'handle-dot' }));
      group.append(
        el('circle', { cx: position.x, cy: position.y, r, class: 'handle-ring', 'stroke-width': 2 * px }),
      );
      group.append(
        el(
          'text',
          {
            x: position.x,
            y: position.y,
            class: 'handle-label',
            'font-size': 13 * px,
            'text-anchor': 'middle',
            'dominant-baseline': 'central',
          },
          name,
        ),
      );
      layer.append(group);
    }
  }
}
