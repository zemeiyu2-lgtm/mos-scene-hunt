"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { SettingsProvider, useOnlineStatus } from "./providers";
import { GpsProvider } from "./gps-provider";
import { HuntProvider } from "./hunt-provider";
import { resolveActiveGameId } from "@/lib/content";
import { subscribeToCurrentAuthoredGame } from "@/lib/storage";

/**
 * Root provider stack.
 *
 * Order is load-bearing: Settings -> GPS -> Hunt. Hunt reads GPS, which reads
 * Settings; reversing any pair creates a render loop or an undefined read on
 * first paint.
 *
 * ServiceWorkerRegistrar is mounted here rather than in app/layout.tsx because
 * it needs SettingsProvider's online status. It renders nothing visible, so its
 * position in the tree does not affect layout.
 */
export function RootProviders({ children }: { children: React.ReactNode }) {
  const gameId = useActiveGameId();

  return (
    <SettingsProvider>
      <ServiceWorkerRegistrar />
      <GpsProvider>
        {/* Remounting (via key) is deliberate: the provider resolves its pack
            once per identity, so a switch from the bundled demo to a freshly
            authored pack must build a new one rather than patch the old. */}
        <HuntProvider key={gameId} gameId={gameId}>
          {children}
        </HuntProvider>
      </GpsProvider>
    </SettingsProvider>
  );
}

/**
 * Which pack the app should load.
 *
 * Starts from the server-rendered default (hydration is then deterministic:
 * the pointer is browser-local and unknowable on the server) and swaps in the
 * authored pack right after mount if the designer has saved one.
 */
function useActiveGameId(): string {
  const subscribe = useCallback((onChange: () => void) => {
    const unsubscribeStorage = subscribeToCurrentAuthoredGame(onChange);
    window.addEventListener("focus", onChange);
    return () => {
      unsubscribeStorage();
      window.removeEventListener("focus", onChange);
    };
  }, []);

  // A non-null snapshot on both server and first client render keeps the
  // markup identical; the authored id overwrites it in the commit phase.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      const requested = new URLSearchParams(window.location.search).get("game");
      return requested ? resolveActiveGameId(requested) : resolveActiveGameId();
    },
    () => resolveActiveGameId(null),
  );

  const [active, setActive] = useState(snapshot);
  useEffect(() => {
    setActive(snapshot);
  }, [snapshot]);

  return active;
}

/**
 * Registers the service worker.
 *
 * Only in production: a service worker in `next dev` serves stale chunks and
 * makes hot reload confusing to debug.
 *
 * NOTE: this component must actually be rendered somewhere. It previously lived
 * in this file unreferenced, which meant no service worker ever registered and
 * every offline guarantee in the spec silently did not hold.
 */
export function ServiceWorkerRegistrar() {
  const online = useOnlineStatus();
  const [swReady, setSwReady] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NEXT_PUBLIC_ENABLE_SW === "0") return;

    let cancelled = false;

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;
        // A registration resolves as soon as the worker is *registered*, not
        // when it is active. Waiting for `ready` is what makes the first load
        // controllable by the worker, which the offline path depends on.
        await navigator.serviceWorker.ready;
        if (cancelled) return;
        setSwReady(Boolean(reg.active));
      } catch (err) {
        // A failed SW registration is not fatal: the app still runs online.
        console.warn("[scene-hunt] service worker registration failed", err);
      }
    };
    void register();

    return () => {
      cancelled = true;
    };
  }, []);

  // Rendered only for diagnostics; keeps the hook from being unused.
  return <span hidden data-sw-ready={swReady} data-online={online} />;
}
