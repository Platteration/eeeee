/** Point UUIDs identify locations; labels and descriptions are presentation only. */
export function normalizePointDescription(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

export function pointDisplayName(point) {
  const description = normalizePointDescription(point.description);
  return `${point.label}${description ? ` · ${description}` : ''}`;
}

/** Validate only a newly assigned label. Imported legacy labels stay intact. */
export function validatePointLabel(value, points = [], excludeId) {
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label || label.length > 40) throw new Error('Use a point number or code between 1 and 40 characters.');
  const key = label.toLowerCase();
  if (key === 'a' || key === 'b') throw new Error('A and B are reserved for the reference points. Choose another number or code.');
  if (points.some(point => (excludeId === undefined || point.id !== excludeId) && String(point.label).trim().toLowerCase() === key)) {
    throw new Error('Duplicate point number or code. Choose a unique label.');
  }
  return label;
}

/** Name warnings are repair suggestions, never a reason to discard a point. */
export function labelWarnings(doc) {
  const warnings = [];
  const counts = new Map();
  for (const point of doc.points) {
    const key = String(point.label).trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const point of doc.points) {
    try {
      const label = validatePointLabel(point.label);
      if (counts.get(label.toLowerCase()) > 1) throw new Error('Duplicate point number or code. Choose a unique label.');
      if (label !== point.label) throw new Error('Remove the extra spaces around this point number or code.');
    } catch (error) {
      warnings.push({ kind: 'label', ids: [point.id], message: `Point ${point.label || '(unnamed)'}: ${error.message} Its measurements can still be corrected.` });
    }
  }
  return warnings;
}
