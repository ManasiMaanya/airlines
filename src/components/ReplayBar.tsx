"use client";

import { useEffect } from "react";
import { formatAge } from "@/lib/format";
import { useAirspace } from "@/store/airspace";

export function ReplayBar() {
  const snapshots = useAirspace((state) => state.snapshots);
  const replay = useAirspace((state) => state.replay);
  const setReplay = useAirspace((state) => state.setReplay);
  const toggleReplay = useAirspace((state) => state.toggleReplay);
  const ready = snapshots.length >= 2;
  const max = Math.max(0, snapshots.length - 1);
  const index = Math.min(replay.index, max);
  const frame = snapshots[Math.min(snapshots.length - 1, Math.max(0, Math.floor(index)))];

  useEffect(() => {
    if (!replay.on || !replay.playing) return;
    const id = window.setInterval(() => {
      const state = useAirspace.getState();
      const frames = state.snapshots;
      if (frames.length < 2) {
        state.setReplay({ playing: false });
        return;
      }
      const cursor = state.replay.index;
      const left = Math.min(Math.floor(cursor), frames.length - 2);
      const span = Math.max(1000, frames[left + 1].t - frames[left].t);
      const next = cursor + (200 / span) * state.replay.speed;
      if (next >= frames.length - 1) state.setReplay({ index: frames.length - 1, playing: false });
      else state.setReplay({ index: next });
    }, 200);
    return () => window.clearInterval(id);
  }, [replay.on, replay.playing]);

  return (
    <footer className="flex flex-wrap items-center gap-3 border-t border-line bg-panel px-4 py-2">
      <button
        type="button"
        onClick={toggleReplay}
        disabled={!ready && !replay.on}
        className="rounded border border-line px-2.5 py-1 text-[12px] text-paper disabled:text-muted"
      >
        {replay.on ? "Exit replay" : "Replay"}
      </button>
      <button
        type="button"
        disabled={!replay.on || !ready}
        onClick={() => setReplay({ playing: !replay.playing })}
        className="rounded border border-line px-2.5 py-1 text-[12px] text-paper disabled:text-muted"
      >
        {replay.playing ? "Pause" : "Play"}
      </button>
      <input
        aria-label="Replay position"
        type="range"
        min={0}
        max={max}
        step={0.01}
        disabled={!replay.on || !ready}
        value={replay.on ? index : max}
        onChange={(event) => setReplay({ index: Number(event.target.value), playing: false })}
        className="min-w-[140px] flex-1 accent-amber"
      />
      <div className="flex gap-1">
        {[1, 4, 12].map((speed) => (
          <button
            key={speed}
            type="button"
            disabled={!replay.on}
            onClick={() => setReplay({ speed })}
            className={`rounded border px-2 py-1 font-mono text-[11px] disabled:text-muted ${replay.speed === speed ? "border-amber text-amber" : "border-line text-muted"}`}
          >
            {speed}×
          </button>
        ))}
      </div>
      <p className="font-mono text-[11px] text-muted">
        {ready
          ? `${snapshots.length} frames${frame ? ` · ${formatAge(Date.now() - frame.t)} ago` : ""}`
          : "Collecting frames for replay"}
      </p>
    </footer>
  );
}
