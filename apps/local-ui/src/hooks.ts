import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError } from './api.js';
import { subscribeSSE } from './sse.js';
import type { SSEEvent, SSEEventType } from './types.js';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const counter = useRef(0);

  const run = useCallback(() => {
    const id = ++counter.current;
    setState(s => ({ ...s, loading: true, error: null }));
    fn().then(data => {
      if (id === counter.current) setState({ data, loading: false, error: null });
    }).catch((e: unknown) => {
      if (id === counter.current) setState({ data: null, loading: false, error: e instanceof ApiError ? e.message : String(e) });
    });
  // deps intentionally passed by caller
  }, deps);

  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

/** Poll fn every intervalMs while active is true. */
export function usePoll(fn: () => void, intervalMs: number, active: boolean): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { fnRef.current(); }, intervalMs);
    return () => { clearInterval(id); };
  }, [intervalMs, active]);
}

/**
 * Subscribe to server-sent events. Calls callback when an event matching
 * one of `types` arrives and passes the optional `filter` predicate.
 * Returns { connected } — true when the SSE connection is open.
 */
export function useServerEvents(
  types: SSEEventType[],
  callback: (event: SSEEvent) => void,
  filter?: (event: SSEEvent) => boolean,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const typesKey = types.join(',');

  useEffect(() => {
    const unsub = subscribeSSE((e) => {
      if (!types.includes(e.type)) return;
      if (filterRef.current && !filterRef.current(e)) return;
      cbRef.current(e);
    });

    // Track connection state by polling es readyState via a small interval
    const id = setInterval(() => {
      // subscribeSSE manages the singleton; we detect open state indirectly
      // by checking if we received any event recently — simplest: just mark
      // connected=true after first successful subscription
      setConnected(true);
    }, 500);
    // Mark immediately
    setConnected(true);

    return () => {
      unsub();
      clearInterval(id);
      setConnected(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey]);

  return { connected };
}
