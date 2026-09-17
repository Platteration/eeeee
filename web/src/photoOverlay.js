import { parseDocument, toWireFormat } from './plotDocument.js';
import { measurePoints } from './measurements.js';
import { pointDisplayName } from './pointNames.js';

export const PHOTO_PROJECT_FORMAT = 'abplot-photo-project';
export const photoSettings = () => ({ opacity: 0.9, labels: true, distances: false, outline: true, closed: true, project: false });
export function plotLandmarks(doc) {
  return [{ id: 'A', label: 'A', position: doc.pointA, needsRemeasure: doc.baselineNeedsRemeasure }, { id: 'B', label: 'B', position: doc.pointB, needsRemeasure: doc.baselineNeedsRemeasure }, ...doc.points];
}

function normalize(points) {
  const cx = points.reduce((sum, p) => sum + p.x / points.length, 0);
  const cy = points.reduce((sum, p) => sum + p.y / points.length, 0);
  const scale = Math.max(...points.map(p => Math.hypot(p.x - cx, p.y - cy)));
  if (!Number.isFinite(scale) || scale < 1e-8) throw Error('Use distinct, well-spaced matches.');
  return { point: p => ({ x: (p.x - cx) / scale, y: (p.y - cy) / scale }), restore: p => ({ x: p.x * scale + cx, y: p.y * scale + cy }) };
}

/** Normalized least squares homography. It applies only to a single plane.
 * See https://docs.opencv.org/4.0.0/d9/dab/tutorial_homography.html.
 * Coordinates are normalized before solving to avoid pixel/plot scale drift.
 */
export function fitPhotoProjection(matches) {
  if (matches.length < 4) throw Error('Match at least four points spread around the same pool plane to project the remaining points.');
  const source = normalize(matches.map(m => m.position)), target = normalize(matches.map(m => m.photo));
  const normal = Array.from({ length: 8 }, () => Array(9).fill(0));
  const add = (row, value) => { for (let i = 0; i < 8; i++) { for (let j = 0; j < 8; j++) normal[i][j] += row[i] * row[j]; normal[i][8] += row[i] * value; } };
  for (const match of matches) {
    const { x, y } = source.point(match.position), { x: u, y: v } = target.point(match.photo);
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(normal[row][col]) > Math.abs(normal[pivot][col])) pivot = row;
    if (Math.abs(normal[pivot][col]) < 1e-9) throw Error('These matches do not define perspective. Choose points spread in two directions, not along one edge.');
    [normal[pivot], normal[col]] = [normal[col], normal[pivot]];
    const divisor = normal[col][col]; for (let j = col; j < 9; j++) normal[col][j] /= divisor;
    for (let row = 0; row < 8; row++) if (row !== col) { const factor = normal[row][col]; for (let j = col; j < 9; j++) normal[row][j] -= factor * normal[col][j]; }
  }
  const h = normal.map(row => row[8]);
  const project = position => {
    const { x, y } = source.point(position), w = h[6] * x + h[7] * y + 1;
    if (!Number.isFinite(w) || Math.abs(w) < 1e-7) return null;
    const p = target.restore({ x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w });
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  };
  let sum = 0;
  for (const match of matches) { const p = project(match.position); if (!p) throw Error('The projection is unstable. Adjust the matched points.'); sum += (p.x - match.photo.x) ** 2 + (p.y - match.photo.y) ** 2; }
  return { project, error: Math.sqrt(sum / matches.length) };
}

export function overlayGeometry(doc, photo) {
  const landmarks = plotLandmarks(doc);
  const matched = landmarks.filter(p => Object.hasOwn(photo.pins, p.id)).map(p => ({ ...p, photo: photo.pins[p.id] }));
  let projection = null, message = `${matched.length} matched points. Click a point's location on the photo to match it.`;
  if (photo.settings.project) {
    try { projection = fitPhotoProjection(matched); message = `Perspective fit: ${matched.length} matches, ${projection.error.toFixed(1)} px average error. Hollow markers are projected; solid markers are your matches.`; }
    catch (error) { message = error.message; }
  }
  const points = landmarks.map(point => ({ ...point, photo: photo.pins[point.id] ?? projection?.project(point.position), matched: Object.hasOwn(photo.pins, point.id) })).filter(p => p.photo && p.photo.x >= 0 && p.photo.x <= photo.width && p.photo.y >= 0 && p.photo.y <= photo.height);
  return { points, message, projection };
}

export function serializePhotoProject(doc, photo) {
  return JSON.stringify({ format: PHOTO_PROJECT_FORMAT, version: 1, document: toWireFormat(doc), photo }, null, 2);
}
export function parsePhotoProject(text) {
  if (text.length > 8 * 1024 * 1024) throw Error('Choose a photo project smaller than 8 MB.');
  let raw; try { raw = JSON.parse(text); } catch { throw Error('This is not valid photo-project JSON.'); }
  if (raw?.format !== PHOTO_PROJECT_FORMAT || raw.version !== 1) throw Error('Choose an ABPlot photo project. Regular plot JSON is opened from the main editor.');
  const document = parseDocument(raw.document), p = raw.photo;
  if (!p || typeof p.dataUrl !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(p.dataUrl)) throw Error('The project must contain an embedded PNG photo.');
  if (![p.width, p.height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 4000) || p.width * p.height > 4000000) throw Error('The project photo dimensions are invalid.');
  if (!p.pins || typeof p.pins !== 'object' || Array.isArray(p.pins)) throw Error('Photo matches are invalid.');
  const ids = new Set(plotLandmarks(document).map(point => point.id)), pins = {};
  for (const [id, point] of Object.entries(p.pins)) {
    if (!ids.has(id)) continue;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > p.width || point.y < 0 || point.y > p.height) throw Error('A photo match lies outside the image.');
    pins[id] = { x: point.x, y: point.y };
  }
  const settings = photoSettings();
  for (const key of ['labels', 'distances', 'outline', 'closed', 'project']) if (typeof p.settings?.[key] === 'boolean') settings[key] = p.settings[key];
  if (Number.isFinite(p.settings?.opacity) && p.settings.opacity >= 0 && p.settings.opacity <= 1) settings.opacity = p.settings.opacity;
  return { document, photo: { dataUrl: p.dataUrl, width: p.width, height: p.height, name: typeof p.name === 'string' ? p.name.slice(0, 120) : 'Pool photo', pins, settings } };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function photoOverlaySvg(doc, photo, { selected = null, markerSize = Math.max(photo.width, photo.height) / 80, includePhoto = true, interactive = false } = {}) {
  const { points } = overlayGeometry(doc, photo), byId = new Map(points.map(p => [p.id, p]));
  const measurements = new Map(measurePoints(doc).map(p => [p.id, p]));
  const size = markerSize, pieces = [];
  if (includePhoto) pieces.push(`<image href="${photo.dataUrl}" width="${photo.width}" height="${photo.height}"/>`);
  pieces.push(`<g opacity="${photo.settings.opacity}">`);
  if (photo.settings.outline) {
    const order = doc.points.map(p => p.id);
    if (photo.settings.closed && order.length > 2) order.push(order[0]);
    for (let i = 1; i < order.length; i++) {
      const a = byId.get(order[i - 1])?.photo, b = byId.get(order[i])?.photo;
      if (a && b) pieces.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#00e5ff" stroke-width="${size / 3}"/>`);
    }
  }
  if (byId.has('A') && byId.has('B')) {
    const a = byId.get('A').photo, b = byId.get('B').photo;
    pieces.push(`<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#fff" stroke-width="${size / 5}" stroke-dasharray="${size / 2}"/>`);
  }
  for (const point of points) {
    const { x, y } = point.photo, color = point.id === 'A' ? '#34c759' : point.id === 'B' ? '#ff3b30' : '#00e5ff';
    pieces.push(`<g data-photo-id="${escape(point.id)}"><title>${escape(pointDisplayName(point) + (point.needsRemeasure ? ' · needs remeasurement' : ''))}</title>`);
    // 44 CSS-pixel hit targets on screen; keep the exported marker compact.
    if (interactive) pieces.push(`<rect x="${x - size * 2.45}" y="${y - size * 2.45}" width="${size * 4.9}" height="${size * 4.9}" fill="transparent" data-photo-hit=""/>`);
    pieces.push(`<circle cx="${x}" cy="${y}" r="${size}" fill="${point.matched ? color : '#0008'}" stroke="${selected === point.id ? '#ffea00' : '#fff'}" stroke-width="${size / 5}"/>`);
    if (photo.settings.labels) {
      let label = point.label + (point.needsRemeasure ? ' · remeasure' : '');
      const m = measurements.get(point.id);
      if (photo.settings.distances && m?.fromA !== null && m?.fromA !== undefined) {
        const divisor = doc.unit === 'feet' ? 0.3048 : 1, unit = doc.unit === 'feet' ? 'ft' : 'm';
        label += ` · A ${(m.fromA / divisor).toFixed(2)} / B ${(m.fromB / divisor).toFixed(2)} ${unit}`;
      }
      pieces.push(`<text x="${x + size * 1.3}" y="${y - size * 1.1}" fill="#fff" stroke="#000" stroke-width="${size / 5}" paint-order="stroke" font-family="system-ui,sans-serif" font-size="${size * 1.3}">${escape(label)}</text>`);
    }
    pieces.push('</g>');
  }
  pieces.push('</g>');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${photo.width}" height="${photo.height}" viewBox="0 0 ${photo.width} ${photo.height}"><title>${escape(doc.name || 'Pool photo overlay')}</title>${pieces.join('')}</svg>`;
}
