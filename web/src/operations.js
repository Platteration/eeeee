/** A latest-only operation; a cancelled read may finish but cannot commit. */
export class LatestOperation {
  #generation = 0;
  cancel() { this.#generation++; }
  start() { const generation = ++this.#generation; return () => generation === this.#generation; }
}

export async function withTimeout(promise, milliseconds = 30000, message = 'The operation timed out. Please try again.') {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
