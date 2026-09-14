import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const failure = (status, code, message) => new ApiError(status, code, message);

/** Single-container accounting: reserve durably before calling a paid API. */
export function dailyQuota(directory, limit = 100, clock = () => new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error('Invalid daily image limit');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'ocr-usage.json');
  let ledger = { day: '', used: 0 };
  try { ledger = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Usage accounting cannot be read'); }
  if (typeof ledger.day !== 'string' || !Number.isSafeInteger(ledger.used) || ledger.used < 0) throw Error('Usage accounting is invalid');
  const write = value => { writeFileSync(`${file}.tmp`, JSON.stringify(value), { mode: 0o600, flush: true }); renameSync(`${file}.tmp`, file); };
  write(ledger); // Fail closed before exposing OCR if the volume is not writable.
  return { reserve() {
    const day = clock().toISOString().slice(0, 10);
    const next = { day, used: ledger.day === day ? ledger.used + 1 : 1 };
    if (next.used > limit) throw failure(429, 'daily_limit', 'The pilot has reached its daily image limit. Local recognition is still available.');
    try { write(next); ledger = next; } catch { throw failure(503, 'accounting', 'Online recognition is unavailable. Use local recognition.'); }
  } };
}

export function validatePng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.toString('ascii', 12, 16) !== 'IHDR') throw failure(415, 'unsupported_image', 'Upload a prepared PNG image.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 50 || height < 50 || width > 4000 || height > 4000 || width * height > 4000000) throw failure(413, 'image_dimensions', 'Use an image between 50 pixels and 4 megapixels.');
}

async function readBody(request, limit) {
  if (Number(request.headers['content-length']) > limit) { request.resume(); throw failure(413, 'body_size', 'The image or request is too large.'); }
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length; if (size > limit) throw failure(413, 'body_size', 'The image or request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function azureProvider({ endpoint, key, fetchImpl = fetch, pollInterval = 800 }) {
  const base = new URL(endpoint);
  if (base.protocol !== 'https:' || base.username || base.password) throw Error('Azure endpoint must use HTTPS');
  return async (bytes, signal) => {
    const headers = { 'Ocp-Apim-Subscription-Key': key };
    const response = await fetchImpl(new URL('/documentintelligence/documentModels/prebuilt-read:analyze?api-version=2024-11-30', base), { method: 'POST', headers: { ...headers, 'Content-Type': 'image/png' }, body: bytes, signal, redirect: 'error' });
    if (response.status === 429) throw failure(429, 'provider_limit', 'The recognition service is busy. Try again later or use local recognition.');
    if (response.status !== 202) throw failure(502, 'provider_failure', 'The recognition service could not accept the image.');
    const location = response.headers.get('operation-location');
    if (!location) throw failure(502, 'provider_failure', 'The recognition service returned an invalid response.');
    const operation = new URL(location);
    if (operation.origin !== base.origin) throw failure(502, 'provider_failure', 'The recognition service returned an invalid location.');
    while (!signal.aborted) {
      await delay(pollInterval, undefined, { signal });
      const result = await fetchImpl(operation, { headers, signal, redirect: 'error' });
      if (!result.ok) throw failure(502, 'provider_failure', 'Could not retrieve the recognition result.');
      const data = await result.json();
      if (data.status === 'failed') throw failure(422, 'recognition_failed', 'The image could not be read. Try a clearer crop.');
      if (data.status === 'succeeded') {
        return { text: data.analyzeResult?.content ?? '', words: (data.analyzeResult?.pages ?? []).flatMap(page => (page.words ?? []).map(word => ({ text: word.content, confidence: word.confidence, polygon: word.polygon }))) };
      }
    }
    throw failure(504, 'timeout', 'Recognition timed out. Try a smaller crop.');
  };
}

export function createOcrHandler({ code, secret, origin, quota, provider, timeout = 60000 } = {}) {
  const enabled = Boolean(code && secret && origin && quota && provider);
  const active = new Set(), attempts = new Map();
  const hmac = text => createHmac('sha256', secret).update(text).digest('hex');
  const equal = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function session(request) {
    const token = request.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('abplot_ocr='))?.slice(11);
    if (!token) return null;
    const [id, expires, signature] = token.split('.');
    if (!id || !expires || !signature || !equal(hmac(`${id}.${expires}`), signature) || Number(expires) <= Date.now()) return null;
    return id;
  }
  return async (request, response) => {
    const path = (request.url ?? '').split('?')[0];
    if (!path.startsWith('/api/ocr')) return false;
    const send = (status, body, headers = {}) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); response.end(JSON.stringify(body)); };
    let job;
    try {
      if (request.method === 'GET' && path === '/api/ocr/config') { send(200, { enabled }); return true; }
      if (!enabled) throw failure(503, 'not_configured', 'Online recognition is not configured. Use local recognition or paste measurements.');
      if (request.method !== 'POST') throw failure(405, 'method', 'Use POST for this operation.');
      if (request.headers.origin !== origin) throw failure(403, 'origin', 'Open this service from the configured ABPlot website.');
      if (path === '/api/ocr/session') {
        const ip = request.socket.remoteAddress ?? 'unknown', now = Date.now();
        for (const [key, value] of attempts) if (now - value.start > 15 * 60000) attempts.delete(key);
        if (attempts.size >= 1000 && !attempts.has(ip)) throw failure(429, 'access_limit', 'Too many access attempts. Try again later.');
        const entry = attempts.get(ip) ?? { start: now, count: 0 }; entry.count++; attempts.set(ip, entry);
        if (entry.count > 5) throw failure(429, 'access_limit', 'Too many access attempts. Try again in 15 minutes.');
        let payload;
        try { payload = JSON.parse((await readBody(request, 1024)).toString('utf8')); } catch (error) { if (error instanceof ApiError) throw error; throw failure(400, 'invalid_request', 'Enter the pilot access code.'); }
        if (typeof payload?.code !== 'string' || !equal(hmac(payload.code), hmac(code))) throw failure(401, 'access_code', 'The pilot access code was not accepted.');
        const value = `${randomBytes(16).toString('hex')}.${Date.now() + 8 * 3600000}`;
        send(200, { authenticated: true }, { 'Set-Cookie': `abplot_ocr=${value}.${hmac(value)}; HttpOnly; SameSite=Strict; Path=/api/ocr; Max-Age=28800${origin.startsWith('https:') ? '; Secure' : ''}` });
        return true;
      }
      if (path !== '/api/ocr') throw failure(404, 'not_found', 'Unknown OCR operation.');
      job = session(request);
      if (!job) throw failure(401, 'authentication', 'Enter your pilot access code to use online recognition.');
      if (active.has(job)) { job = null; throw failure(409, 'busy', 'A recognition request is already running for this session.'); }
      if (active.size >= 4) { job = null; throw failure(429, 'busy', 'The pilot is busy. Try again shortly.'); }
      active.add(job);
      if (request.headers['content-type'] !== 'image/png') throw failure(415, 'unsupported_image', 'Upload a prepared PNG image.');
      const bytes = await readBody(request, 4 * 1024 * 1024); validatePng(bytes); quota.reserve();
      const controller = new AbortController();
      const abort = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', abort);
      let timer;
      try {
        const result = await Promise.race([provider(bytes, controller.signal), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure(504, 'timeout', 'Recognition timed out. Try a smaller crop.')); }, timeout); })]);
        if (!response.destroyed) send(200, result);
      } finally { clearTimeout(timer); response.removeListener('close', abort); }
    } catch (error) {
      const known = error instanceof ApiError;
      if (!response.headersSent && !response.destroyed) send(known ? error.status : 502, { error: { code: known ? error.code : 'service_failure', message: known ? error.message : 'Online recognition failed. Your plot is unchanged; local entry remains available.' } });
    } finally { if (job) active.delete(job); }
    return true;
  };
}

export function configuredOcr(env = process.env) {
  const required = ['AZURE_OCR_ENDPOINT', 'AZURE_OCR_KEY', 'OCR_ACCESS_CODE', 'OCR_SESSION_SECRET', 'OCR_PUBLIC_ORIGIN', 'OCR_DATA_DIR'];
  if (required.some(key => !env[key])) return createOcrHandler();
  try {
    if (env.OCR_ACCESS_CODE.length < 12 || env.OCR_SESSION_SECRET.length < 32) throw Error('Pilot code or session secret is too short');
    const origin = new URL(env.OCR_PUBLIC_ORIGIN);
    if (origin.origin !== env.OCR_PUBLIC_ORIGIN || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) throw Error('Public origin must use HTTPS');
    return createOcrHandler({ code: env.OCR_ACCESS_CODE, secret: env.OCR_SESSION_SECRET, origin: origin.origin, quota: dailyQuota(env.OCR_DATA_DIR, Number(env.OCR_DAILY_LIMIT ?? 100)), provider: azureProvider({ endpoint: env.AZURE_OCR_ENDPOINT, key: env.AZURE_OCR_KEY }) });
  } catch { console.error('Online OCR disabled: check service configuration and the writable usage volume.'); return createOcrHandler(); }
}
