"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { project } from "@/lib/geo";
import { buildScene } from "@/lib/scene";
import { callsignOrIcao, formatAlt, formatSpeed } from "@/lib/format";
import type { BBox } from "@/lib/types";
import { useAirspace } from "@/store/airspace";

type Hit = { id: string; x: number; y: number };

export default function MapView() {
  const host = useRef<HTMLDivElement>(null);
  const coord = useRef<HTMLParagraphElement>(null);
  const hint = useRef<HTMLParagraphElement>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const switchThemeRef = useRef<((theme: "dark" | "satellite") => void) | null>(null);
  const [mapTheme, setMapTheme] = useState<"dark" | "satellite">("dark");

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const map = L.map(el, {
      zoomControl: false,
      minZoom: 3,
      maxZoom: 16,
      attributionControl: true,
    });

    const darkLayers: L.TileLayer[] = [
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 16,
        attribution: "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
      }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 16,
      }),
    ];

    const satelliteLayers: L.TileLayer[] = [
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        attribution: "Imagery &copy; Esri",
      }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
      }),
    ];

    darkLayers.forEach((layer) => layer.addTo(map));

    switchThemeRef.current = (nextTheme: "dark" | "satellite") => {
      if (nextTheme === "dark") {
        satelliteLayers.forEach((layer) => {
          if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        darkLayers.forEach((layer) => {
          if (!map.hasLayer(layer)) layer.addTo(map);
        });
      } else {
        darkLayers.forEach((layer) => {
          if (map.hasLayer(layer)) map.removeLayer(layer);
        });
        satelliteLayers.forEach((layer) => {
          if (!map.hasLayer(layer)) layer.addTo(map);
        });
      }
      setMapTheme(nextTheme);
    };

    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.control.scale({ position: "bottomleft", metric: true, imperial: true }).addTo(map);

    const canvas = document.createElement("canvas");
    canvas.className = "aircraft-layer";
    canvas.style.position = "absolute";
    canvas.style.left = "0";
    canvas.style.top = "0";
    map.getPanes().overlayPane?.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const hits: Hit[] = [];
    const hover = { id: null as string | null };
    const draw = {
      active: false,
      suppressClick: false,
      start: null as L.LatLng | null,
      current: null as L.LatLng | null,
    };
    let font = "sans-serif";

    const fit = () => {
      const region = useAirspace.getState().region;
      map.fitBounds(
        [
          [region.lamin, region.lomin],
          [region.lamax, region.lomax],
        ],
        { padding: [36, 36], animate: false },
      );
    };
    fitRef.current = fit;

    const paint = () => {
      const size = map.getSize();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(size.x * dpr) || canvas.height !== Math.floor(size.y * dpr)) {
        canvas.width = Math.floor(size.x * dpr);
        canvas.height = Math.floor(size.y * dpr);
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      }
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      hits.length = 0;

      const state = useAirspace.getState();
      const scene = buildScene(state.aircraft, state.snapshots, state.replay, state.filters, state.selectedId, Date.now());
      const alerted = new Set(Object.values(state.activeAlerts).map((alert) => alert.icao24));
      const showAllTrails = state.trails === "all" && scene.length <= 140;

      strokeBox(ctx, map, state.region, "rgba(240,180,41,0.9)");
      if (draw.start && draw.current) {
        const box = boxFrom(draw.start, draw.current);
        strokeBox(ctx, map, box, "rgba(94,234,212,0.9)");
      }

      for (const item of scene) {
        if (item.lat == null || item.lon == null) continue;
        const selected = item.aircraft.icao24 === state.selectedId;
        const trail = item.aircraft.observations;
        if ((selected || showAllTrails) && trail.length > 0) {
          ctx.beginPath();
          ctx.lineWidth = selected ? 1.7 : 1;
          ctx.strokeStyle = selected ? "rgba(94,234,212,0.9)" : "rgba(94,234,212,0.28)";
          let open = false;
          for (const point of trail) {
            const pt = map.latLngToContainerPoint([point.lat, point.lon]);
            if (!open || point.gap) {
              ctx.moveTo(pt.x, pt.y);
              open = true;
            } else ctx.lineTo(pt.x, pt.y);
          }
          if (item.extrapolated) {
            const tip = map.latLngToContainerPoint([item.lat, item.lon]);
            ctx.lineTo(tip.x, tip.y);
          }
          ctx.stroke();
        }
      }

      for (const item of scene) {
        if (item.lat == null || item.lon == null) continue;
        const pt = map.latLngToContainerPoint([item.lat, item.lon]);
        if (pt.x < -40 || pt.y < -40 || pt.x > size.x + 40 || pt.y > size.y + 40) continue;
        const selected = item.aircraft.icao24 === state.selectedId;
        const fill = colorFor(item, alerted.has(item.aircraft.icao24));

        // Tactical 60-second velocity vector leader line
        if (!item.aircraft.onGround && item.speed != null && item.speed > 5 && item.track != null) {
          const distM = item.speed * 60;
          const proj = project(item.lat, item.lon, item.track, distM);
          const projPt = map.latLngToContainerPoint([proj.lat, proj.lon]);

          ctx.save();
          ctx.beginPath();
          ctx.strokeStyle = selected ? "rgba(94,234,212,0.85)" : "rgba(215,228,241,0.22)";
          ctx.lineWidth = selected ? 1.5 : 0.8;
          ctx.moveTo(pt.x, pt.y);
          ctx.lineTo(projPt.x, projPt.y);
          ctx.stroke();

          if (selected) {
            // 30s midpoint tick
            const midProj = project(item.lat, item.lon, item.track, distM * 0.5);
            const midPt = map.latLngToContainerPoint([midProj.lat, midProj.lon]);
            ctx.beginPath();
            ctx.arc(midPt.x, midPt.y, 2, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(94,234,212,0.9)";
            ctx.fill();

            // 60s arrowhead tick
            ctx.beginPath();
            ctx.arc(projPt.x, projPt.y, 2.5, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(94,234,212,0.9)";
            ctx.fill();
          }
          ctx.restore();
        }

        // Tactical range rings & reticle around selected aircraft
        if (selected) {
          ctx.save();
          for (const [nm, distM] of [[5, 9260], [10, 18520]] as const) {
            const edge = project(item.lat, item.lon, 90, distM);
            const edgePt = map.latLngToContainerPoint([edge.lat, edge.lon]);
            const radius = Math.abs(edgePt.x - pt.x);
            if (radius > 10 && radius < 2500) {
              ctx.beginPath();
              ctx.setLineDash([3, 4]);
              ctx.strokeStyle = "rgba(94,234,212,0.35)";
              ctx.lineWidth = 1;
              ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.fillStyle = "rgba(94,234,212,0.7)";
              ctx.font = `500 10px ${font}`;
              ctx.fillText(`${nm} NM`, pt.x + radius + 4, pt.y + 3);
            }
          }

          // Target reticle corner brackets
          const b = 15;
          ctx.strokeStyle = "rgba(240,180,41,0.9)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pt.x - b, pt.y - b + 5); ctx.lineTo(pt.x - b, pt.y - b); ctx.lineTo(pt.x - b + 5, pt.y - b);
          ctx.moveTo(pt.x + b - 5, pt.y - b); ctx.lineTo(pt.x + b, pt.y - b); ctx.lineTo(pt.x + b, pt.y - b + 5);
          ctx.moveTo(pt.x - b, pt.y + b - 5); ctx.lineTo(pt.x - b, pt.y + b); ctx.lineTo(pt.x - b + 5, pt.y + b);
          ctx.moveTo(pt.x + b - 5, pt.y + b); ctx.lineTo(pt.x + b, pt.y + b); ctx.lineTo(pt.x + b, pt.y + b - 5);
          ctx.stroke();
          ctx.restore();
        }

        if (item.status === "coasting" || item.status === "stale" || item.frozen) {
          ctx.beginPath();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = fill;
          ctx.lineWidth = 1;
          ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        if (item.aircraft.onGround) drawSquare(ctx, pt.x, pt.y, fill, selected);
        else drawChevron(ctx, pt.x, pt.y, item.track, fill, selected);
        hits.push({ id: item.aircraft.icao24, x: pt.x, y: pt.y });
        if (selected || hover.id === item.aircraft.icao24) {
          const name = callsignOrIcao(item.aircraft.callsign, item.aircraft.icao24);
          const sub = `${formatAlt(item.alt, state.units, item.aircraft.onGround)}  ${formatSpeed(item.speed, state.units)}`;
          drawTag(ctx, pt.x, pt.y, name, sub, font, alerted.has(item.aircraft.icao24));
        }
      }
    };

    let frame = 0;
    const loop = () => {
      paint();
      frame = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      if (document.hidden) cancelAnimationFrame(frame);
      else loop();
    };

    fit();
    font = getComputedStyle(document.body).fontFamily || font;
    map.invalidateSize();
    loop();

    const pick = (point: L.Point) => {
      let best: string | null = null;
      let bestD = 16;
      for (const hit of hits) {
        const distance = Math.hypot(hit.x - point.x, hit.y - point.y);
        if (distance < bestD) {
          bestD = distance;
          best = hit.id;
        }
      }
      return best;
    };

    const onClick = (event: L.LeafletMouseEvent) => {
      if (draw.active || draw.suppressClick) {
        draw.suppressClick = false;
        return;
      }
      useAirspace.getState().select(pick(event.containerPoint));
    };
    const onMove = (event: L.LeafletMouseEvent) => {
      if (draw.active && draw.start) draw.current = event.latlng;
      else hover.id = pick(event.containerPoint);
      if (coord.current) {
        coord.current.textContent = `${event.latlng.lat.toFixed(3)}°, ${event.latlng.lng.toFixed(3)}°`;
      }
    };
    const onDown = (event: L.LeafletMouseEvent) => {
      if (!draw.active) return;
      draw.start = event.latlng;
      draw.current = event.latlng;
    };
    const onUp = () => {
      if (!draw.active || !draw.start || !draw.current) return;
      const box = boxFrom(draw.start, draw.current);
      draw.active = false;
      draw.suppressClick = true;
      draw.start = null;
      draw.current = null;
      map.dragging.enable();
      el.style.cursor = "";
      if (hint.current) hint.current.hidden = true;
      useAirspace.getState().setCustomRegion(box);
    };

    map.on("click", onClick);
    map.on("mousemove", onMove);
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    map.on("dragstart", () => {
      if (useAirspace.getState().follow) useAirspace.getState().setFollow(false);
    });
    document.addEventListener("visibilitychange", onVisibility);

    const followTimer = setInterval(() => {
      const state = useAirspace.getState();
      if (!state.follow || !state.selectedId) return;
      const scene = buildScene(state.aircraft, state.snapshots, state.replay, state.filters, state.selectedId, Date.now());
      const item = scene.find((entry) => entry.aircraft.icao24 === state.selectedId);
      if (item?.lat == null || item.lon == null) return;
      map.panTo([item.lat, item.lon], { animate: true, duration: 0.6 });
    }, 1200);

    const unsub = useAirspace.subscribe((state, prev) => {
      if (state.region !== prev.region) fit();
      if (state.drawNonce !== prev.drawNonce) {
        draw.active = true;
        draw.start = null;
        draw.current = null;
        map.dragging.disable();
        el.style.cursor = "crosshair";
        if (hint.current) hint.current.hidden = false;
      }
      if (state.selectedId && state.selectedId !== prev.selectedId) {
        const scene = buildScene(state.aircraft, state.snapshots, state.replay, state.filters, state.selectedId, Date.now());
        const item = scene.find((entry) => entry.aircraft.icao24 === state.selectedId);
        if (item?.lat != null && item.lon != null) map.panTo([item.lat, item.lon], { animate: true });
      }
    });

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      clearInterval(followTimer);
      unsub();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      map.remove();
    };
  }, []);

  const message = useAirspace((state) => state.feed.message);
  const status = useAirspace((state) => state.feed.status);

  return (
    <div className="relative h-full min-h-[320px]">
      <div ref={host} className="absolute inset-0" />
      <div className="absolute left-3 top-3 z-[400] flex items-center gap-1 rounded border border-line bg-ink/80 p-1 backdrop-blur-md">
        <button
          type="button"
          onClick={() => switchThemeRef.current?.("dark")}
          className={`rounded px-2 py-0.5 font-mono text-[11px] cursor-pointer ${mapTheme === "dark" ? "bg-panel-2 text-cyan font-semibold border border-cyan/40" : "text-muted hover:text-paper"}`}
        >
          Radar Dark
        </button>
        <button
          type="button"
          onClick={() => switchThemeRef.current?.("satellite")}
          className={`rounded px-2 py-0.5 font-mono text-[11px] cursor-pointer ${mapTheme === "satellite" ? "bg-panel-2 text-cyan font-semibold border border-cyan/40" : "text-muted hover:text-paper"}`}
        >
          Satellite
        </button>
        <button
          type="button"
          onClick={() => fitRef.current?.()}
          title="Fit view to region"
          className="rounded border border-line px-2 py-0.5 font-mono text-[11px] text-muted hover:border-amber hover:text-amber cursor-pointer"
        >
          Fit Sector
        </button>
      </div>
      <p ref={coord} className="pointer-events-none absolute right-3 top-3 z-[400] rounded bg-ink/80 px-2 py-1 font-mono text-[11px] text-paper" />
      <p ref={hint} hidden className="absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded border border-cyan/50 bg-ink/90 px-3 py-1.5 text-[12px] text-cyan">
        Drag a rectangle to monitor that region.
      </p>
      <ul className="pointer-events-none absolute bottom-14 left-3 z-[400] space-y-1 rounded bg-ink/75 px-2.5 py-2 font-mono text-[10px] text-muted">
        <li><i className="mr-1.5 inline-block h-2 w-2 bg-cyan" /> airborne</li>
        <li><i className="mr-1.5 inline-block h-2 w-2 bg-paper/80" /> ground</li>
        <li><i className="mr-1.5 inline-block h-2 w-2 rounded-full border border-amber" /> coasting / estimated</li>
        <li><i className="mr-1.5 inline-block h-2 w-2 bg-rose" /> alert</li>
      </ul>
      {message && status !== "live" && status !== "cached" && (
        <p className="absolute left-3 right-14 top-3 z-[400] rounded border border-amber/40 bg-ink/90 px-3 py-2 text-[12px] leading-relaxed text-amber">
          {message}
        </p>
      )}
    </div>
  );
}

function boxFrom(a: L.LatLng, b: L.LatLng): BBox {
  return {
    lamin: Math.min(a.lat, b.lat),
    lamax: Math.max(a.lat, b.lat),
    lomin: Math.min(a.lng, b.lng),
    lomax: Math.max(a.lng, b.lng),
  };
}

function strokeBox(ctx: CanvasRenderingContext2D, map: L.Map, box: BBox, color: string) {
  const nw = map.latLngToContainerPoint([box.lamax, box.lomin]);
  const se = map.latLngToContainerPoint([box.lamin, box.lomax]);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
  ctx.restore();
}

function colorFor(item: { status: string; aircraft: { onGround: boolean; verticalRate: number | null } }, alert: boolean): string {
  if (alert) return "#ff6b81";
  if (item.status === "coasting") return "#f0b429";
  if (item.status === "departed" || item.status === "stale") return "#c4b389";
  if (item.aircraft.onGround) return "#b7c5d4";
  if ((item.aircraft.verticalRate ?? 0) > 0.8) return "#5eead4";
  if ((item.aircraft.verticalRate ?? 0) < -0.8) return "#8eb6ff";
  return "#e7eef6";
}

function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, track: number | null, fill: string, selected: boolean) {
  ctx.save();
  ctx.translate(x, y);
  if (track != null) ctx.rotate((track * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(5.5, 7);
  ctx.lineTo(0, 3.2);
  ctx.lineTo(-5.5, 7);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = "#f0b429";
    ctx.lineWidth = 1.4;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSquare(ctx: CanvasRenderingContext2D, x: number, y: number, fill: string, selected: boolean) {
  ctx.fillStyle = fill;
  ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
  if (selected) {
    ctx.strokeStyle = "#f0b429";
    ctx.strokeRect(x - 5, y - 5, 10, 10);
  }
}

function drawTag(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub: string, font: string, alert: boolean) {
  ctx.save();
  ctx.font = `600 12px ${font}`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `11px ${font}`;
  const subWidth = ctx.measureText(sub).width;
  const width = Math.max(titleWidth, subWidth) + 14;
  const left = x + 12;
  const top = y - 24;
  ctx.fillStyle = "rgba(7,16,24,0.9)";
  ctx.strokeStyle = alert ? "rgba(255,107,129,0.9)" : "rgba(240,180,41,0.85)";
  ctx.lineWidth = 1;
  roundRect(ctx, left, top, width, 30, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = alert ? "#ff6b81" : "#f0b429";
  ctx.font = `600 12px ${font}`;
  ctx.fillText(title, left + 7, top + 13);
  ctx.fillStyle = "#d7e4f1";
  ctx.font = `11px ${font}`;
  ctx.fillText(sub, left + 7, top + 24);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
