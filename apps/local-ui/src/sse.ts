import type { SSEEvent, SSEEventType } from './types.js';

// Re-export from shared-types via types.ts
export type { SSEEvent, SSEEventType };

type Listener = (e: SSEEvent) => void;
type ConnectListener = () => void;

// --- Singleton EventSource with exponential backoff reconnect ---
let es: EventSource | null = null;
let refCount = 0;
let retryDelay = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();
const connectListeners = new Set<ConnectListener>();

function dispatch(e: SSEEvent): void {
  listeners.forEach(fn => fn(e));
}

function connect(): void {
  if (es) return;
  es = new EventSource('/api/events');

  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as SSEEvent;
      // skip the initial connected signal (type is run.updated but no id — just a ping)
      if (data.type) dispatch(data);
    } catch { /* ignore malformed frames */ }
  };

  es.onopen = () => {
    retryDelay = 1000;
    connectListeners.forEach(fn => fn());
  };

  es.onerror = () => {
    es?.close();
    es = null;
    if (refCount > 0) scheduleReconnect();
  };
}

function scheduleReconnect(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (refCount > 0) connect();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

function acquire(): void {
  refCount++;
  if (refCount === 1) connect();
}

function release(): void {
  refCount--;
  if (refCount === 0) {
    es?.close();
    es = null;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryDelay = 1000;
  }
}

// Pause reconnect when tab is hidden, resume when visible
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && refCount > 0 && !es) {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      connect();
    }
  });
}

export function subscribeSSE(fn: Listener, onConnect?: ConnectListener): () => void {
  acquire();
  listeners.add(fn);
  if (onConnect) connectListeners.add(onConnect);
  return () => {
    listeners.delete(fn);
    if (onConnect) connectListeners.delete(onConnect);
    release();
  };
}
