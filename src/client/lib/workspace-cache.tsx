// Shared cache for the monorepo-wide panels (Overview / Certify / Distribution /
// Fleet / Observability). The cache lifts data fetching to the App level so
// that switching between panels is instant — the panel renders cached data
// immediately and triggers a background refresh that updates in place. Before
// this layer, every panel re-fetched on mount, which felt like "the page is
// rescanning every time I click a tab" even though the daemon already had warm
// data.
//
// Each slice carries: `data` (most recent successful response), `error`,
// `loading` (true while a fetch is in flight, even if cached data is showing),
// `lastFetchedAt`, and a `refresh()` action that re-runs the fetch on demand.
// The provider runs an initial parallel prefetch when the client first lands
// and exposes a background "stale" refresh that fires on tab focus.

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  AiNativeResponse,
  CertificationResponse,
  DistributionData,
  FleetStatus,
  InboxSnapshot,
  ObservBoard,
  PlatformParityResponse,
  ReadinessResponse,
} from "../api/types";
import { withTimeout } from "./with-timeout";

export interface CacheSlice<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  lastFetchedAt: number | null;
  refresh: () => Promise<void>;
}

export interface WorkspaceCache {
  certification: CacheSlice<CertificationResponse>;
  aiNative: CacheSlice<AiNativeResponse>;
  distribution: CacheSlice<DistributionData>;
  fleet: CacheSlice<FleetStatus>;
  inbox: CacheSlice<InboxSnapshot>;
  observability: CacheSlice<ObservBoard>;
  readiness: CacheSlice<ReadinessResponse>;
  platformParity: CacheSlice<PlatformParityResponse>;
  /**
   * True once the initial prefetch has *attempted* every slice. The slices
   * themselves may still be loading individually — this just means we have
   * something cached (success or error) for the first paint.
   */
  bootstrapped: boolean;
}

const noopRefresh = async () => {};

const EMPTY: WorkspaceCache = {
  certification: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  aiNative: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  distribution: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  fleet: { data: null, error: null, loading: false, lastFetchedAt: null, refresh: noopRefresh },
  inbox: { data: null, error: null, loading: false, lastFetchedAt: null, refresh: noopRefresh },
  observability: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  readiness: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  platformParity: {
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
    refresh: noopRefresh,
  },
  bootstrapped: false,
};

const Ctx = createContext<WorkspaceCache>(EMPTY);

interface ProviderProps {
  client: WorkspaceApiClient | null;
  children: ReactNode;
  /**
   * Background refresh interval, ms. The provider only re-fetches a slice
   * when its last successful fetch is older than this; instantaneous tab
   * switches reuse cached data without firing new requests.
   */
  refreshIntervalMs?: number;
  /**
   * The active monorepo root. When it changes (the operator picked or typed a
   * new folder in the topbar), the root-scoped slices — certification,
   * AI-native, and readiness — refetch so the checks follow the selected
   * directory instead of showing results for the previous root. Root-
   * independent slices (fleet/inbox/observability) are left untouched.
   */
  root?: string;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function WorkspaceCacheProvider({
  client,
  children,
  refreshIntervalMs = 30_000,
  root,
}: ProviderProps) {
  type Slice<T> = Omit<CacheSlice<T>, "refresh">;
  const [cert, setCert] = useState<Slice<CertificationResponse>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [ai, setAi] = useState<Slice<AiNativeResponse>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [dist, setDist] = useState<Slice<DistributionData>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [fleet, setFleet] = useState<Slice<FleetStatus>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [inbox, setInbox] = useState<Slice<InboxSnapshot>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [obs, setObs] = useState<Slice<ObservBoard>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [readiness, setReadiness] = useState<Slice<ReadinessResponse>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [parity, setParity] = useState<Slice<PlatformParityResponse>>({
    data: null,
    error: null,
    loading: false,
    lastFetchedAt: null,
  });
  const [bootstrapped, setBootstrapped] = useState(false);

  // Mounted-guard so async tasks finishing after unmount don't setState.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchCert = useCallback(async () => {
    if (!client) return;
    setCert((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getCertification(), "SDLC certification scan");
      if (!aliveRef.current) return;
      setCert({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setCert((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchAi = useCallback(async () => {
    if (!client) return;
    setAi((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getAiNative(), "AI-native scan");
      if (!aliveRef.current) return;
      setAi({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setAi((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchDist = useCallback(async () => {
    if (!client) return;
    setDist((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getDistribution(), "Distribution scan");
      if (!aliveRef.current) return;
      setDist({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setDist((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchFleet = useCallback(async () => {
    if (!client) return;
    setFleet((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getFleetStatus(), "Fleet status check");
      if (!aliveRef.current) return;
      setFleet({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setFleet((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchInbox = useCallback(async () => {
    if (!client) return;
    setInbox((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getInbox(), "Inbox fetch");
      if (!aliveRef.current) return;
      setInbox({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setInbox((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchObs = useCallback(async () => {
    if (!client) return;
    setObs((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getObservability(), "Observability fetch");
      if (!aliveRef.current) return;
      setObs({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setObs((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchReadiness = useCallback(async () => {
    if (!client) return;
    setReadiness((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getReadiness(), "Production readiness scan");
      if (!aliveRef.current) return;
      setReadiness({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setReadiness((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  const fetchParity = useCallback(async () => {
    if (!client) return;
    setParity((s) => ({ ...s, loading: true }));
    try {
      const next = await withTimeout(client.getPlatformParity(), "Platform parity scan");
      if (!aliveRef.current) return;
      setParity({ data: next, error: null, loading: false, lastFetchedAt: Date.now() });
    } catch (err) {
      if (!aliveRef.current) return;
      setParity((s) => ({ ...s, loading: false, error: errMsg(err) }));
    }
  }, [client]);

  // Initial parallel prefetch the moment a client lands. Each slice fails open
  // — a thrown CapabilityError (cloud runtime) parks the error on the slice
  // without taking the rest of the cache down.
  useEffect(() => {
    if (!client) return;
    setBootstrapped(false);
    Promise.allSettled([
      fetchCert(),
      fetchAi(),
      fetchDist(),
      fetchFleet(),
      fetchInbox(),
      fetchObs(),
      fetchReadiness(),
      fetchParity(),
    ]).then(() => {
      if (!aliveRef.current) return;
      setBootstrapped(true);
    });
  }, [
    client,
    fetchCert,
    fetchAi,
    fetchDist,
    fetchFleet,
    fetchInbox,
    fetchObs,
    fetchReadiness,
    fetchParity,
  ]);

  // Refetch the root-scoped slices (cert / ai-native / readiness) whenever the
  // workspace root changes — the operator picked or typed a new folder in the
  // topbar. The fetch callbacks resolve the current root at call time (via
  // localStorage + __WORKSPACE_CONFIG__), so this effect just re-triggers them. We track the last-seen root in a ref and only
  // refetch on an actual change, so the first render (already covered by the
  // bootstrap prefetch above) doesn't double-fetch. Root-independent slices
  // (fleet/inbox/observability) are intentionally left alone.
  const lastRootRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!client) return;
    if (lastRootRef.current === undefined) {
      lastRootRef.current = root;
      return;
    }
    if (lastRootRef.current === root) return;
    lastRootRef.current = root;
    fetchCert();
    fetchAi();
    fetchReadiness();
  }, [client, root, fetchCert, fetchAi, fetchReadiness]);

  // Background staleness sweep — re-fetch a slice if its last-fetched is
  // older than refreshIntervalMs. Cheap because the daemon's own 30 s cache
  // ETags us back to 304.
  useEffect(() => {
    if (!client) return;
    const tick = () => {
      const now = Date.now();
      if (cert.lastFetchedAt && now - cert.lastFetchedAt > refreshIntervalMs) {
        fetchCert();
      }
      if (ai.lastFetchedAt && now - ai.lastFetchedAt > refreshIntervalMs) {
        fetchAi();
      }
      if (dist.lastFetchedAt && now - dist.lastFetchedAt > refreshIntervalMs) {
        fetchDist();
      }
      if (fleet.lastFetchedAt && now - fleet.lastFetchedAt > refreshIntervalMs) {
        fetchFleet();
      }
      if (inbox.lastFetchedAt && now - inbox.lastFetchedAt > refreshIntervalMs) {
        fetchInbox();
      }
      if (obs.lastFetchedAt && now - obs.lastFetchedAt > refreshIntervalMs) {
        fetchObs();
      }
      if (readiness.lastFetchedAt && now - readiness.lastFetchedAt > refreshIntervalMs) {
        fetchReadiness();
      }
      if (parity.lastFetchedAt && now - parity.lastFetchedAt > refreshIntervalMs) {
        fetchParity();
      }
    };
    const id = setInterval(tick, Math.min(refreshIntervalMs / 3, 10_000));
    return () => clearInterval(id);
  }, [
    client,
    refreshIntervalMs,
    cert.lastFetchedAt,
    ai.lastFetchedAt,
    dist.lastFetchedAt,
    fleet.lastFetchedAt,
    inbox.lastFetchedAt,
    obs.lastFetchedAt,
    readiness.lastFetchedAt,
    parity.lastFetchedAt,
    fetchCert,
    fetchAi,
    fetchDist,
    fetchFleet,
    fetchInbox,
    fetchObs,
    fetchReadiness,
    fetchParity,
  ]);

  const value = useMemo<WorkspaceCache>(
    () => ({
      certification: { ...cert, refresh: fetchCert },
      aiNative: { ...ai, refresh: fetchAi },
      distribution: { ...dist, refresh: fetchDist },
      fleet: { ...fleet, refresh: fetchFleet },
      inbox: { ...inbox, refresh: fetchInbox },
      observability: { ...obs, refresh: fetchObs },
      readiness: { ...readiness, refresh: fetchReadiness },
      platformParity: { ...parity, refresh: fetchParity },
      bootstrapped,
    }),
    [
      cert,
      ai,
      dist,
      fleet,
      inbox,
      obs,
      readiness,
      parity,
      bootstrapped,
      fetchCert,
      fetchAi,
      fetchDist,
      fetchFleet,
      fetchInbox,
      fetchObs,
      fetchReadiness,
      fetchParity,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspaceCache(): WorkspaceCache {
  return useContext(Ctx);
}
