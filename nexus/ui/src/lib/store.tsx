/**
 * Application store: project selection, SSE connection, live events and the
 * approval queue. Pages read from this instead of each fetching independently,
 * which keeps the "current project" consistent across all 13 surfaces.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ProjectWithCount } from './api';
import type { NexusEvent, SettingsResponse } from '../types';

export interface Toast {
  id: number;
  message: string;
  level: 'info' | 'error';
}

interface StoreValue {
  projects: ProjectWithCount[];
  project: ProjectWithCount | null;
  projectId: string | null;
  setProjectId: (id: string | null) => void;
  refreshProjects: () => Promise<void>;
  reloadKey: number;
  bumpReload: () => void;

  events: NexusEvent[];
  connected: boolean;
  pendingApprovals: number;

  settings: SettingsResponse | null;
  refreshSettings: () => Promise<void>;

  toasts: Toast[];
  toast: (message: string, level?: 'info' | 'error') => void;

  health: {
    providers: string[];
    database: { backend?: 'sqlite' | 'mongodb'; location?: string; version: number; serverVersion?: string | null };
    browser: { driver: string; available: boolean; reason?: string };
  } | null;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<ProjectWithCount[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [events, setEvents] = useState<NexusEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingApprovals, setPendingApprovals] = useState(0);
  const [health, setHealth] = useState<StoreValue['health']>(null);
  const toastId = useRef(0);
  const lastEventId = useRef(0);

  const toast = useCallback((message: string, level: 'info' | 'error' = 'info') => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, message, level }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4200);
  }, []);

  const refreshProjects = useCallback(async () => {
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
      setProjectIdState((current) => {
        if (current && list.some((p) => p.id === current)) return current;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [toast]);

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await api.settings());
    } catch {
      /* settings are non-critical for first paint */
    }
  }, []);

  const bumpReload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    void refreshProjects();
    void refreshSettings();
    api
      .health()
      .then((value) => setHealth(value))
      .catch(() => setHealth(null));
    api
      .approvals('pending')
      .then(({ approvals }) => setPendingApprovals(approvals.length))
      .catch(() => undefined);
  }, [refreshProjects, refreshSettings]);

  /* -------------------------------------------------------------- SSE --- */
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      source = new EventSource(`/api/events/stream?since=${lastEventId.current}`);
      source.onopen = () => setConnected(true);
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as NexusEvent;
          lastEventId.current = Math.max(lastEventId.current, event.id);
          setEvents((current) => [event, ...current].slice(0, 300));
          if (event.type === 'approval.required') setPendingApprovals((n) => n + 1);
          if (event.type === 'approval.resolved') setPendingApprovals((n) => Math.max(0, n - 1));
          if (event.type === 'task.completed' || event.type === 'task.failed') bumpReload();
        } catch {
          /* malformed event is ignored, never fatal */
        }
      };
      source.onerror = () => {
        setConnected(false);
        source?.close();
        // Reconnect with backoff; EventSource retries on its own only for some
        // error classes, so we drive it explicitly.
        retry = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [bumpReload]);

  const project = useMemo(() => projects.find((p) => p.id === projectId) ?? null, [projects, projectId]);

  const value: StoreValue = {
    projects,
    project,
    projectId,
    setProjectId: setProjectIdState,
    refreshProjects,
    reloadKey,
    bumpReload,
    events,
    connected,
    pendingApprovals,
    settings,
    refreshSettings,
    toasts,
    toast,
    health,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside StoreProvider');
  return context;
}

/** Small helper for pages that load data on mount and on project switch. */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: React.DependencyList,
): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    loader()
      .then((result) => {
        if (mounted.current) setData(result);
      })
      .catch((err: Error) => {
        if (mounted.current) setError(err.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}
