/** Validate geometry before it can enter history, storage or an export. */
export function validateGeometry(doc) {
  const finite = (values) => values.every(Number.isFinite);
  const all = [doc.pointA, doc.pointB, ...doc.points.map(p => p.position)];
  if (!all.every(p => p && finite([p.x, p.y]))) throw new Error('Coordinates must be finite numbers.');
  if (!Number.isFinite(doc.abDistance) || doc.abDistance < 0) throw new Error('A–B distance must be a finite, non-negative number.');
  const dx = doc.pointB.x - doc.pointA.x, dy = doc.pointB.y - doc.pointA.y;
  const length = Math.hypot(dx, dy);
  const scale = length > 1 && doc.abDistance > 0 ? doc.abDistance / length : 0;
  if (!finite([length, scale]) || (length > 1 && doc.abDistance > 0 && scale === 0)) throw new Error('This scale is outside the supported numeric range.');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of all) {
    const x = p.x - doc.pointA.x, y = p.y - doc.pointA.y;
    if (!finite([p.x * 2, p.y * 2, x, y, Math.hypot(x, y), x * scale, y * scale, Math.hypot(x * scale, y * scale)])) {
      throw new Error('These measurements are too large for a valid plot.');
    }
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (!finite([(maxX - minX) * 4, (maxY - minY) * 4, (maxX - minX) * scale, (maxY - minY) * scale])) throw new Error('The plot extent is too large.');
  return doc;
}
