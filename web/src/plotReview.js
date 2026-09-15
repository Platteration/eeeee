/** Checks for a closed outline in entered point order; concave outlines are valid. */
export function reviewOutline(doc) {
  const points = doc.points, warnings = [];
  if (doc.outlineDirection === 'off') return { warnings, direction: null, message: 'Outline checks are off.' };
  if (points.length < 3) return { warnings, direction: null, message: 'Add at least three boundary points in the order you walk around the pool.' };
  if (points.length > 500) return { warnings, direction: null, message: 'Outline checks support up to 500 points. Review this larger plot manually.' };
  const origin = points[0].position;
  const scale = Math.max(...points.map(p => Math.hypot(p.position.x - origin.x, p.position.y - origin.y)));
  const normalized = points.map(p => ({ ...p, x: (p.position.x - origin.x) / (scale || 1), y: (p.position.y - origin.y) / (scale || 1) }));
  const eps = 1e-9, cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a, b, p) => Math.abs(cross(a, b, p)) <= eps && p.x >= Math.min(a.x, b.x) - eps && p.x <= Math.max(a.x, b.x) + eps && p.y >= Math.min(a.y, b.y) - eps && p.y <= Math.max(a.y, b.y) + eps;
  const intersect = (a, b, c, d) => {
    const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
    return ((x > eps && y < -eps || x < -eps && y > eps) && (z > eps && w < -eps || z < -eps && w > eps)) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  };
  for (let i = 0; i < normalized.length && warnings.length < 8; i++) {
    const a = normalized[i], b = normalized[(i + 1) % normalized.length];
    for (let j = i + 1; j < normalized.length && warnings.length < 8; j++) {
      const c = normalized[j], d = normalized[(j + 1) % normalized.length];
      if (Math.hypot(a.x - c.x, a.y - c.y) < 1e-7) {
        warnings.push({ kind: 'overlap', ids: [a.id, c.id], message: `${a.label} and ${c.label} overlap. Check for a duplicate or remeasure these points.` });
      } else if (j !== i + 1 && !(i === 0 && j === normalized.length - 1) && intersect(a, b, c, d)) {
        warnings.push({ kind: 'crossing', ids: [...new Set([a.id, b.id, c.id, d.id])], message: `Edges ${a.label}–${b.label} and ${c.label}–${d.label} cross or touch. Check their order, then remeasure the listed points if the order is correct.` });
      }
    }
  }
  const area = normalized.reduce((sum, p, i) => { const q = normalized[(i + 1) % normalized.length]; return sum + p.x * q.y - q.x * p.y; }, 0);
  const direction = Math.abs(area) <= eps || warnings.length ? null : area > 0 ? 'clockwise' : 'counterclockwise';
  if (!warnings.length && !direction) warnings.push({ kind: 'flat', ids: points.map(p => p.id), message: 'The outline is flat or has no enclosed area. Check the point locations and A/B measurements.' });
  if (direction && ['clockwise', 'counterclockwise'].includes(doc.outlineDirection) && doc.outlineDirection !== direction) {
    warnings.push({ kind: 'direction', ids: [], message: `These points run ${direction}. You chose ${doc.outlineDirection}. Reverse the sequence or check the chosen direction.` });
  }
  return { warnings, direction, message: warnings.length ? `${warnings.length} outline check${warnings.length === 1 ? '' : 's'} to review. The checks suggest candidates; they cannot identify a wrong measurement with certainty.` : `${points.length} boundary points · ${direction} on this plan · no crossed edges found.` };
}

/** Preserve small optional review fields in plot JSON and photo projects. */
export function reviewFields(value, baseline = false) {
  const note = baseline ? 'baselineNote' : 'note', flag = baseline ? 'baselineNeedsRemeasure' : 'needsRemeasure';
  return { ...(typeof value[note] === 'string' && value[note] ? { [note]: value[note].slice(0, 1000) } : {}), ...(value[flag] === true ? { [flag]: true } : {}),
    ...(baseline && ['clockwise', 'counterclockwise', 'off'].includes(value.outlineDirection) ? { outlineDirection: value.outlineDirection } : {}) };
}
