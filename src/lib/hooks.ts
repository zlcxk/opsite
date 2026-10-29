import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

interface FetchState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useApi<T>(path: string | null, pollMs = 0) {
  const [state, setState] = useState<FetchState<T>>({ data: null, error: null, loading: Boolean(path) });
  const mounted = useRef(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refetch = useCallback(async (silent = false) => {
    if (!pathRef.current) return;
    if (!silent) setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await api.get<T>(pathRef.current);
      if (mounted.current && pathRef.current === path) {
        setState({ data, loading: false, error: null });
      }
    } catch (error) {
      if (mounted.current) {
        setState((prev) => ({
          data: prev.data,
          loading: false,
          error: error instanceof Error ? error.message : '加载失败',
        }));
      }
    }
    // path is intentionally the only dependency for the request
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    setState({ data: null, loading: Boolean(path), error: null });
    if (path) void refetch();
    return () => {
      mounted.current = false;
    };
  }, [path, refetch]);

  useEffect(() => {
    if (!pollMs || !path) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refetch(true);
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, path, refetch]);

  return { ...state, refetch, setData: (data: T) => setState((prev) => ({ ...prev, data })) };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · Opsite` : 'Opsite · 运维情报台';
  }, [title]);
}

export function useClickOutside<T extends HTMLElement>(
  onOutside: () => void,
  active = true,
) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, onOutside]);
  return ref;
}

export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
