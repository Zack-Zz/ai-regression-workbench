import { useState, useEffect, useCallback, useRef } from 'react';
import { ApiError } from './api.js';

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
