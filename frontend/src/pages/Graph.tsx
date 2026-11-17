import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY,
  SimulationLinkDatum, SimulationNodeDatum,
} from "d3-force";
import { ArrowLeft, Loader2, Maximize2, Minus, Plus, Settings2 } from "lucide-react";
import TopBar from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import api from "@/lib/api";
import type { Area, GraphData, GraphNote } from "@/types";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
type GNode = SimulationNodeDatum & {
  id: string;
  kind: "area" | "note";
  r: number;
  color: string;
  label: string;
  area?: Area;
  note?: GraphNote;
};
type GEdge = SimulationLinkDatum<GNode> & { kind: "member" | "shared"; color: string; why?: string };

const NOTE_R = 6;
const MUTED = "hsl(var(--muted-foreground))";

/** Radius grows with the square root of the note count, so the circle's
 *  area — what the eye compares — is proportional to the number of notes. */
function areaRadius(count: number, focus = false): number {
  return (focus ? 44 : 22) + (focus ? 7 : 9) * Math.sqrt(count);
}

function noteLabel(n: GraphNote): string {
  return n.title || n.snippet || n.date;
}

function sharedEdges(notes: GraphNote[]): GEdge[] {
  // Connect notes that share a #tag or @person (skip very common ones).
  const byKey = new Map<string, string[]>();
  notes.forEach((n) => {
    n.tags.forEach((t) => byKey.set(`#${t}`, [...(byKey.get(`#${t}`) || []), n.note_id]));
    n.people.forEach((p) => byKey.set(`@${p}`, [...(byKey.get(`@${p}`) || []), n.note_id]));
  });
  const seen = new Map<string, GEdge>();
  byKey.forEach((ids, key) => {
    if (ids.length < 2 || ids.length > 25) return;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        const e = seen.get(k);
        if (e) e.why = `${e.why} ${key}`;
        else seen.set(k, { source: ids[i], target: ids[j], kind: "shared", color: MUTED, why: key });
      }
    }
  });
  return Array.from(seen.values());
}

function buildLayout(data: GraphData, focusId?: string): { nodes: GNode[]; edges: GEdge[] } {
  const areaMap = new Map(data.areas.map((a) => [a.area_id, a]));
  const focus = focusId ? areaMap.get(focusId) : undefined;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];

  const areas = focus ? [focus] : [...data.areas].sort((a, b) => b.note_count - a.note_count);
  areas.forEach((a) => {
    nodes.push({
      id: a.area_id, kind: "area", r: areaRadius(a.note_count, !!focus), color: a.color, label: a.name, area: a,
      ...(focus ? { fx: 0, fy: 0 } : {}),
    });
  });

  data.notes.forEach((n) => {
    const own = n.area_ids.filter((id) => areaMap.has(id));
    const first = focus ? focus : areaMap.get(own[0]);
    nodes.push({ id: n.note_id, kind: "note", r: NOTE_R, color: first ? first.color : MUTED, label: noteLabel(n), note: n });
    (focus ? [focus.area_id] : own).forEach((aid) => {
      edges.push({ source: n.note_id, target: aid, kind: "member", color: areaMap.get(aid)!.color });
    });
  });
  if (focus) edges.push(...sharedEdges(data.notes));

  const areaNodes = nodes.filter((n) => n.kind === "area");
  const clusterR = Math.sqrt(areaNodes.reduce((s, a) => s + (a.r + 30) ** 2, 0));
  const membership = new Map<string, number>();
  edges.forEach((e) => {
    if (e.kind === "member") membership.set(e.source as string, (membership.get(e.source as string) || 0) + 1);
  });

  const sim = forceSimulation<GNode>(nodes)
    .force("link", forceLink<GNode, GEdge>(edges).id((d) => d.id)
      .distance((e) => {
        if (e.kind === "shared") return 70;
        const area = typeof e.target === "object" ? (e.target as GNode) : undefined;
        return (area ? area.r : 30) + (focus ? 110 : 34);
      })
      .strength((e) => (e.kind === "shared" ? 0.04 : 0.7 / (membership.get((e.source as GNode).id) || 1))))
    .force("charge", forceManyBody<GNode>().strength((d) => (d.kind === "area" ? -300 : focus ? -140 : -18)))
    .force("collide", forceCollide<GNode>().radius((d) => d.r + (d.kind === "area" ? 16 : focus ? 26 : 3)).iterations(2))
    // Areas are pulled hard to the centre; unassigned notes drift to an outer ring.
    .force("x", forceX<GNode>(0).strength((d) => (d.kind === "area" ? 0.35 : 0.02)))
    .force("y", forceY<GNode>(0).strength((d) => (d.kind === "area" ? 0.35 : 0.02)))
    .force("orphans", forceRadial<GNode>(clusterR + 170, 0, 0)
      .strength((d) => (d.kind === "note" && !membership.get(d.id) ? 0.25 : 0)))
    .stop();
  const ticks = Math.min(400, 120 + nodes.length);
  for (let i = 0; i < ticks; i++) sim.tick();
  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Pan / zoom viewBox
// ---------------------------------------------------------------------------
type View = { x: number; y: number; w: number; h: number };

function fitView(nodes: GNode[], aspect: number): View {
  if (nodes.length === 0) return { x: -400, y: -300, w: 800, h: 600 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, (n.x || 0) - n.r); maxX = Math.max(maxX, (n.x || 0) + n.r);
    minY = Math.min(minY, (n.y || 0) - n.r); maxY = Math.max(maxY, (n.y || 0) + n.r);
  });
  const pad = 80;
  let w = maxX - minX + pad * 2, h = maxY - minY + pad * 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Graph() {
  const { id: focusId } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError(null); setView(null);
    api.get<GraphData>("/graph", { params: focusId ? { area_id: focusId } : {} })
      .then(({ data }) => alive && setData(data))
      .catch(() => alive && setError("Graph yüklenemedi"));
    return () => { alive = false; };
  }, [focusId]);

  const layout = useMemo(() => (data ? buildLayout(data, focusId) : null), [data, focusId]);
  const focusArea = focusId && data ? data.areas.find((a) => a.area_id === focusId) : undefined;

  const aspect = () => {
    const el = svgRef.current;
    return el && el.clientHeight ? el.clientWidth / el.clientHeight : 1.6;
  };
  const fit = useCallback(() => layout && setView(fitView(layout.nodes, aspect())), [layout]);
  useEffect(() => { fit(); }, [fit]);

  // Neighbourhood for hover highlighting
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    layout?.edges.forEach((e) => {
      const s = (e.source as GNode).id, t = (e.target as GNode).id;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t); m.get(t)!.add(s);
    });
    return m;
  }, [layout]);
  const isLit = (id: string) => !hover || hover === id || !!neighbours.get(hover)?.has(id);

  function toGraph(clientX: number, clientY: number, v: View) {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: v.x + ((clientX - rect.left) / rect.width) * v.w, y: v.y + ((clientY - rect.top) / rect.height) * v.h };
  }
  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    setView((v) => {
      if (!v) return v;
      const rect = svgRef.current!.getBoundingClientRect();
      const p = toGraph(clientX ?? rect.left + rect.width / 2, clientY ?? rect.top + rect.height / 2, v);
      const w = Math.min(Math.max(v.w * factor, 80), 20000), h = (w / v.w) * v.h;
      return { x: p.x - ((p.x - v.x) * w) / v.w, y: p.y - ((p.y - v.y) * h) / v.h, w, h };
    });
  }

  // Non-passive wheel listener so the page doesn't scroll while zooming.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY > 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(e: React.PointerEvent) {
    if (!view) return;
    drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !svgRef.current) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) svgRef.current.setPointerCapture(e.pointerId);
    d.moved = true;
    const rect = svgRef.current.getBoundingClientRect();
    setView({ ...d.view, x: d.view.x - (dx / rect.width) * d.view.w, y: d.view.y - (dy / rect.height) * d.view.h });
  }
  function onPointerUp() {
    setTimeout(() => { drag.current = null; }, 0);
  }
  function activate(n: GNode) {
    if (drag.current?.moved) return;
    if (n.kind === "area") navigate(focusId === n.id ? `/area/${n.id}` : `/graph/area/${n.id}`);
    else navigate(`/note/${n.id}`);
  }

  const showAllLabels = !!focusId && (layout?.nodes.length || 0) <= 60;
  const nodes = layout?.nodes || [];

  return (
    <div className="h-screen flex flex-col paper">
      <TopBar />
      <div className="relative flex-1 min-h-0" data-testid="graph-page">
        {/* Header overlay */}
        <div className="absolute top-4 left-4 right-4 z-10 flex items-start justify-between gap-3 pointer-events-none">
          <div className="pointer-events-auto bg-background/85 backdrop-blur border border-border rounded-md px-4 py-3 max-w-sm">
            {focusId ? (
              <>
                <Link to="/graph" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1">
                  <ArrowLeft className="w-3.5 h-3.5" strokeWidth={1.5} /> Tüm alanlar
                </Link>
                <h1 className="font-serif text-2xl leading-tight flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ background: focusArea?.color }} />
                  {focusArea?.name || "Alan"}
                </h1>
                <p className="text-xs text-muted-foreground mt-1">
                  {data?.notes.length ?? 0} birinci derece not · kesikli çizgiler ortak #etiket / @kişi
                </p>
              </>
            ) : (
              <>
                <div className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground">Graph</div>
                <h1 className="font-serif text-2xl leading-tight">Kişisel alanlar</h1>
                <p className="text-xs text-muted-foreground mt-1">
                  Daire büyüklüğü = not sayısı · bir alana tıklayın
                </p>
              </>
            )}
          </div>
          <div className="pointer-events-auto flex flex-col gap-1 bg-background/85 backdrop-blur border border-border rounded-md p-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => zoomAt(1 / 1.3)} aria-label="Yakınlaştır"><Plus className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => zoomAt(1.3)} aria-label="Uzaklaştır"><Minus className="w-4 h-4" /></Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={fit} aria-label="Sığdır"><Maximize2 className="w-4 h-4" /></Button>
          </div>
        </div>

        {!data && !error && (
          <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        )}
        {error && <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">{error}</div>}
        {data && data.areas.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
            <p className="font-serif text-xl">Henüz kişisel alan tanımlanmamış.</p>
            <Link to="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <Settings2 className="w-4 h-4" strokeWidth={1.5} /> Ayarlar'dan alan ekleyin
            </Link>
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full touch-none select-none cursor-grab active:cursor-grabbing"
          viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : "-400 -300 800 600"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          role="img"
          aria-label="Kişisel alanlar ve notlar graph'ı"
        >
          <g>
            {layout?.edges.map((e, i) => {
              const s = e.source as GNode, t = e.target as GNode;
              const lit = !hover || hover === s.id || hover === t.id;
              return (
                <line
                  key={i}
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  stroke={e.color}
                  strokeOpacity={lit ? (e.kind === "shared" ? 0.45 : 0.35) : 0.06}
                  strokeWidth={e.kind === "shared" ? 1 : 1.25}
                  strokeDasharray={e.kind === "shared" ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                >
                  {e.why && <title>{e.why}</title>}
                </line>
              );
            })}
          </g>
          <g>
            {nodes.filter((n) => n.kind === "note").map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={isLit(n.id) ? 1 : 0.2}
                className="cursor-pointer"
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => activate(n)}
                data-testid={`graph-note-${n.id}`}
              >
                <circle r={n.r} fill={n.color} fillOpacity={0.85} stroke="hsl(var(--background))" strokeWidth={1.5} />
                {n.note && n.note.area_ids.length > 1 && (
                  <circle r={n.r + 3} fill="none" stroke="hsl(var(--foreground))" strokeOpacity={0.35} strokeWidth={1} />
                )}
                {(showAllLabels || hover === n.id) && (
                  <text
                    x={n.r + 5} y={4}
                    fontSize={12}
                    className="font-sans"
                    fill="hsl(var(--foreground))"
                    stroke="hsl(var(--background))" strokeWidth={3} paintOrder="stroke"
                  >
                    {n.label.length > 42 ? n.label.slice(0, 41) + "…" : n.label}
                  </text>
                )}
                <title>{n.note ? `${n.label}\n${n.note.date}` : n.label}</title>
              </g>
            ))}
          </g>
          <g>
            {nodes.filter((n) => n.kind === "area").map((n) => (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                opacity={isLit(n.id) ? 1 : 0.35}
                className="cursor-pointer"
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onClick={() => activate(n)}
                data-testid={`graph-area-${n.id}`}
              >
                <circle r={n.r} fill={n.color} fillOpacity={0.18} stroke={n.color} strokeWidth={2} />
                <text
                  textAnchor="middle" y={-2}
                  fontSize={Math.max(11, Math.min(22, n.r / 2.6))}
                  className="font-serif"
                  fill="hsl(var(--foreground))"
                >
                  {n.label.length > 16 ? n.label.slice(0, 15) + "…" : n.label}
                </text>
                <text textAnchor="middle" y={Math.max(13, n.r / 3)} fontSize={11} className="font-mono" fill={MUTED}>
                  {n.area?.note_count ?? 0} not
                </text>
                <title>{focusId ? `${n.label} — alan sayfasını aç` : `${n.label} — bağlı notları göster`}</title>
              </g>
            ))}
          </g>
        </svg>

        {/* Legend */}
        {!focusId && data && data.areas.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 bg-background/85 backdrop-blur border border-border rounded-md px-3 py-2 flex flex-wrap gap-x-3 gap-y-1 max-w-[calc(100%-2rem)]">
            {data.areas.map((a) => (
              <Link key={a.area_id} to={`/graph/area/${a.area_id}`} className="inline-flex items-center gap-1.5 text-xs hover:underline">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: a.color }} />
                {a.name} <span className="font-mono text-muted-foreground">{a.note_count}</span>
              </Link>
            ))}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: MUTED }} /> alansız
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
