/** Image bytes are immutable and shared by all undo snapshots. */
export function photoState(photo, recoveryId) {
  if (!photo) return null;
  const { name, dataUrl, width, height } = photo;
  return { asset: Object.freeze({ name, dataUrl, width, height }), pins: structuredClone(photo.pins), settings: { ...photo.settings }, recoveryId };
}

export function clonePhotoState(photo) {
  return photo ? { asset: photo.asset, pins: structuredClone(photo.pins), settings: { ...photo.settings }, recoveryId: photo.recoveryId } : null;
}

export function photoFromState(photo) {
  return photo ? { ...photo.asset, pins: photo.pins, settings: photo.settings } : null;
}

export function samePhotoState(a, b) {
  return a === b || (!!a && !!b && a.asset === b.asset && a.recoveryId === b.recoveryId && JSON.stringify(a.pins) === JSON.stringify(b.pins) && JSON.stringify(a.settings) === JSON.stringify(b.settings));
}
