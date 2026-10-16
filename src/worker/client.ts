import { LATEST_ONLY, type Api, type Method, type WorkerRequest, type WorkerResponse } from './protocol';

interface Pending {
  method: Method;
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const newest = new Map<Method, number>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (!msg.ok) return p.reject(new Error(msg.error));
    if ('stale' in msg) return p.resolve(null);
    // a newer request of the same kind was sent meanwhile: ignore this (stale) result
    if (LATEST_ONLY.has(p.method) && newest.get(p.method) !== msg.id) return p.resolve(null);
    p.resolve(msg.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Worker error'));
    pending.clear();
  };
  return worker;
}

/**
 * Call a worker method. For "latest only" methods, the promise resolves to
 * `null` when a newer call superseded this one.
 */
export function call<M extends Method>(
  method: M,
  payload: Api[M][0],
  transfer: Transferable[] = [],
): Promise<Api[M][1] | null> {
  const id = nextId++;
  if (LATEST_ONLY.has(method)) newest.set(method, id);
  return new Promise((resolve, reject) => {
    pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject });
    const req: WorkerRequest<M> = { id, method, payload };
    ensure().postMessage(req, transfer);
  });
}

/** Like `call`, but for methods where `null` cannot happen. */
export async function callStrict<M extends Method>(method: M, payload: Api[M][0], transfer: Transferable[] = []): Promise<Api[M][1]> {
  const r = await call(method, payload, transfer);
  if (r === null) throw new Error(`${method} was superseded`);
  return r;
}
