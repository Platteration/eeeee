/**
 * The plot document: the same shape the iOS app persists, so a file exported
 * here opens there and vice versa.
 *
 * ## Wire format
 * Swift's `PlotDocument` is `Codable`, and Foundation encodes `CGPoint` as a
 * two-element *array* `[x, y]` (not `{"x":…,"y":…}`), `UUID` as an uppercase
 * string, and `LengthUnit` as its raw value:
 *
 * ```json
 * {
 *   "pointA": [100, 400],
 *   "pointB": [300, 400],
 *   "abDistance": 2,
 *   "unit": "meters",
 *   "points": [{ "id": "3F2A…", "position": [200, 300], "label": "1" }]
 * }
 * ```
 *
 * {@link serializeDocument} emits exactly that. {@link parseDocument} also
 * accepts the friendlier `{"x":…,"y":…}` form, so hand-written or
 * third-party files import without ceremony.
 *
 * The optional `name` titles the plot and its exports. Updated iOS versions
 * preserve it; older versions ignore it. An unnamed plot omits the key.
 */

/** Length units, keyed by the raw value Swift's `LengthUnit` encodes. */
export const UNITS = {
  meters: { symbol: 'm', label: 'Meters', toMeters: 1 },
  feet: { symbol: 'ft', label: 'Feet', toMeters: 0.3048 },
};

/** The iOS app's starting document, so both apps open on the same plot. */
export function defaultDocument() {
  return {
    name: '',
    pointA: { x: 100, y: 400 },
    pointB: { x: 300, y: 400 },
    abDistance: 2,
    unit: 'meters',
    points: [],
  };
}

/** The declared A-B distance in meters, whatever unit it is entered in. */
export function abDistanceMeters(doc) {
  return doc.abDistance * UNITS[doc.unit].toMeters;
}

/** Convert the displayed distance without changing the physical plot. */
export function changeUnit(doc, unit) {
  if (!Object.hasOwn(UNITS, unit)) throw new Error('Unknown length unit');
  const distance = abDistanceMeters(doc) / UNITS[unit].toMeters;
  if (!Number.isFinite(distance)) throw new Error('The converted distance is too large');
  doc.abDistance = distance;
  doc.unit = unit;
}

/** A fresh uppercase UUID, matching what Swift's `UUID` encodes. */
export function newId() {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
  return uuid.toUpperCase();
}

/** The next free numeric label, mirroring the iOS app's numbering. */
export function nextLabel(points) {
  const highest = points.reduce((max, point) => {
    const n = Number(point.label);
    return Number.isSafeInteger(n) && n > max ? n : max;
  }, 0);
  if (highest < Number.MAX_SAFE_INTEGER) return String(highest + 1);
  const used = new Set(points.map((point) => point.label));
  let candidate = 1;
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

/** A new plot point at `position`, labelled after the existing `points`. */
export function createPoint(position, points) {
  return { id: newId(), position: { x: position.x, y: position.y }, label: nextLabel(points) };
}

function coercePoint(value, what) {
  if (Array.isArray(value) && value.length >= 2) {
    const [x, y] = value;
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } else if (value && typeof value === 'object' && Number.isFinite(value.x) && Number.isFinite(value.y)) {
    return { x: value.x, y: value.y };
  }
  throw new Error(`${what} must be [x, y] or {"x": …, "y": …} with finite numbers`);
}

/**
 * Validate and normalize anything claiming to be a plot document.
 *
 * Accepts a JSON string or an already-parsed object. Missing `unit` defaults to
 * meters and missing labels are numbered by position, but anything genuinely
 * ambiguous -- a malformed point, an unknown unit, a negative distance --
 * throws an `Error` whose message is fit to show the user.
 *
 * @param {string | object} input
 * @returns {object} a normalized document, sharing no structure with `input`
 */
export function parseDocument(input) {
  let raw = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Not valid JSON: ${error.message}`);
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Expected a JSON object describing a plot');
  }

  const unit = raw.unit === undefined || raw.unit === null ? 'meters' : raw.unit;
  if (!Object.prototype.hasOwnProperty.call(UNITS, unit)) {
    throw new Error(`Unknown unit ${JSON.stringify(unit)} (expected ${Object.keys(UNITS).join(' or ')})`);
  }

  const abDistance = typeof raw.abDistance === 'number' ? raw.abDistance : NaN;
  if (!Number.isFinite(abDistance) || abDistance < 0) {
    throw new Error('abDistance must be a non-negative number');
  }

  const rawPoints = raw.points === undefined || raw.points === null ? [] : raw.points;
  if (!Array.isArray(rawPoints)) throw new Error('points must be an array');

  const ids = new Set();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const points = rawPoints.map((point, index) => {
    if (!point || typeof point !== 'object') throw new Error(`points[${index}] must be an object`);
    let id = typeof point.id === 'string' && uuid.test(point.id) ? point.id.toUpperCase() : newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    return {
      id,
      position: coercePoint(point.position, `points[${index}].position`),
      label: point.label === undefined || point.label === null ? String(index + 1) : String(point.label),
    };
  });

  return {
    name: raw.name === undefined || raw.name === null ? '' : String(raw.name),
    pointA: coercePoint(raw.pointA, 'pointA'),
    pointB: coercePoint(raw.pointB, 'pointB'),
    abDistance,
    unit,
    points,
  };
}

/** The document as a plain object in the iOS wire format (CGPoints as arrays). */
export function toWireFormat(doc) {
  return {
    // Omitted when empty, so an unnamed plot is byte-identical to the phone's.
    ...(doc.name ? { name: doc.name } : {}),
    pointA: [doc.pointA.x, doc.pointA.y],
    pointB: [doc.pointB.x, doc.pointB.y],
    abDistance: doc.abDistance,
    unit: doc.unit,
    points: doc.points.map((point) => ({
      id: point.id,
      position: [point.position.x, point.position.y],
      label: point.label,
    })),
  };
}

/**
 * The document as JSON text, ready to hand to the iOS app.
 *
 * Pretty-printing puts each coordinate array back on one line -- `[100, 400]`
 * rather than four lines per point -- which keeps an exported plot readable and
 * diffable. The result is still ordinary JSON.
 */
export function serializeDocument(doc, { pretty = true } = {}) {
  const json = JSON.stringify(toWireFormat(doc), null, pretty ? 2 : 0);
  return pretty ? json.replace(/\[\s+(-?[\d.eE+-]+),\s+(-?[\d.eE+-]+)\s+\]/g, '[$1, $2]') : json;
}

/**
 * A filename stem for this plot's exports: its name reduced to something safe
 * on every filesystem, or "plot" when it has no name.
 */
export function fileStem(doc) {
  const slug = (doc.name ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return slug || 'plot';
}
