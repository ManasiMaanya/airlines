"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { startPolling, stopPolling } from "@/lib/poller";
import { useAirspace } from "@/store/airspace";
import { Controls } from "./Controls";
import { ReplayBar } from "./ReplayBar";
import { StatusBar } from "./StatusBar";
import { TrafficColumn } from "./TrafficColumn";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[320px] place-items-center text-sm text-muted">Loading map…</div>,
});

type Tab = "map" | "traffic" | "controls";

export function Dashboard() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("map");
  const feed = useAirspace((state) => state.feed);
  const select = useAirspace((state) => state.select);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      try {
        await useAirspace.persist.rehydrate();
      } catch {
        // A broken cache should not block the live feed.
      }
      if (cancel) return;
      setReady(true);
      startPolling();
    })();
    return () => {
      cancel = true;
      stopPolling();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!ready) {
    return (
      <div className="grid h-dvh place-items-center bg-ink">
        <div>
          <p className="font-mono text-[11px] tracking-[0.28em] text-amber">OPENSKY</p>
          <h1 className="mt-2 text-3xl font-semibold">Airspace</h1>
          <p className="mt-2 text-muted">Restoring the last picture…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-ink text-text">
      <StatusBar />
      <div className="flex gap-1 border-b border-line px-3 py-2 lg:hidden">
        {(
          [
            ["map", "Map"],
            ["traffic", "Traffic"],
            ["controls", "Controls"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded border px-3 py-1 text-[12px] ${tab === id ? "border-amber text-amber" : "border-line text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={`${tab === "controls" ? "flex" : "hidden"} min-h-0 flex-1 lg:flex lg:w-[300px] lg:flex-none lg:border-r lg:border-line`}>
          <Controls />
        </div>
        <main className={`${tab === "map" ? "flex" : "hidden"} relative min-h-0 min-w-0 flex-1 flex-col lg:flex`}>
          {feed.message && (
            <div className="border-b border-amber/40 bg-amber/10 px-4 py-2 text-[12px] leading-relaxed text-amber">{feed.message}</div>
          )}
          <div className="min-h-0 flex-1">
            <MapView />
          </div>
        </main>
        <div className={`${tab === "traffic" ? "flex" : "hidden"} min-h-0 flex-1 lg:flex lg:flex-none`}>
          <TrafficColumn />
        </div>
      </div>
      <ReplayBar />
    </div>
  );
}
