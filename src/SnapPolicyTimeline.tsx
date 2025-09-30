import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/**
 * Federal Register Policy Explorer (stacked area timeline)
 * - Filters: Program Area → Structure → Part (supports "All parts")
 * - Types: Proposed Rule, Rule, Notice, Presidential Document
 * - Start/End define timeframe; Zoom changes x-axis units; optional bucketing by Zoom unit
 * - Optional: Include docs without CFR refs (only when Part = All parts)
 * - Chart: stacked area; hover snap + guide line; click bucket → secondary table; modal for details
 */

const FR_BASE = "https://www.federalregister.gov/api/v1";

// ------------------------------- Custom header content slot -------------------------------
// You can supply **strings with HTML** OR **JSX / React nodes** here.
// Examples:
//   "This tool visualizes <b>Federal Register</b> changes over time."
//   (<div className="prose prose-sm"><p><strong>Tip:</strong> Use the Update button after tweaking filters.</p></div>)
// Strings are rendered with `dangerouslySetInnerHTML`; nodes render directly.
export type HeaderChunk = string | React.ReactNode;
const HEADER_CONTENT: HeaderChunk[] = [
  // "", // ← Add your own strings-with-HTML or JSX nodes here
  (<p className="text-lg text-muted-foreground">
    This tool allows exploration of changes to the Federal Register over time, for benefits-related program areas that are important to Nava.
  </p>),
  (<p className="text-lg text-muted-foreground">
  <strong>To use the Explorer,</strong> select a date range and program area you'd like to visualize, and click 'Update'. Selecting a point on the chart will show the documents that were published in the Federal Register on that date. Select a document to learn more about that change.</p>),
  (<p className="text-xs text-muted-foreground mt-6 border-l-2 pl-6 italic">
    The <a className="text-blue-800 hover:underline" href="https://www.federalregister.gov" target="_blank" rel="noopener noreferrer">Federal Register</a> is the U.S. government's official daily journal, publishing proposed and final rules, presidential documents (like Executive Orders), and notices from federal agencies. Published by the National Archives and Records Administration (NARA), it serves as the authoritative source for legal and regulatory changes, providing public notification of federal actions and opportunities for public input.
  </p>),
];

// ------------------------------------------------ Utilities ------------------------------------------------
const fmtDate = (d: Date) => d3.timeFormat("%Y-%m-%d")(d);
const normRange = (s: Date | string, e: Date | string) => {
  const S = s instanceof Date ? s : new Date(s);
  const E = e instanceof Date ? e : new Date(e);
  return +S <= +E ? [S, E] : [E, S];
};
const toQuery = (params: Record<string, any>) => {
  const qp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((it) => qp.append(k, String(it)));
    else if (v !== undefined && v !== null && v !== "") qp.append(k, String(v));
  });
  return qp.toString();
};
const normalizeDocType = (t: unknown) => {
  const s = String(t ?? "").toUpperCase();
  if (s.includes("PRORULE") || s.includes("PROPOSED")) return "PRORULE";
  if (s.includes("RULE")) return "RULE";
  if (s.includes("NOTICE")) return "NOTICE";
  if (s.includes("PRESDOCU") || s.includes("PRESIDENT")) return "PRESDOCU";
  return null;
};
const tickCfg = (u: string) => {
  switch ((u || "months").toLowerCase()) {
    case "days": return { iv: d3.timeDay, fmt: "%b %d" } as const;
    case "weeks": return { iv: d3.timeWeek, fmt: "%b %d" } as const;
    case "months": return { iv: d3.timeMonth, fmt: "%b %Y" } as const;
    case "years": return { iv: d3.timeYear, fmt: "%Y" } as const;
    default: return { iv: d3.timeMonth, fmt: "%b %Y" } as const;
  }
};
const seq = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
const frDocUrl = (d: any) => {
  const u = d?.html_url;
  if (u && /^https?:\/{2}/.test(u)) return u;
  const num = d?.document_number;
  return num ? `https://www.federalregister.gov/documents/${encodeURIComponent(num)}` : "";
};

// ------------------------------------------ Program / Structure / Parts ------------------------------------------
// Minimal but broad coverage set, sized to stay under canvas limits.
const PROGRAMS: { id: string; label: string; structures: { id: string; label: string; title: number; parts: number[] }[] }[] = [
  { id: "SNAP", label: "SNAP", structures: [ { id: "SNAP-7C", label: "Title 7 (Agriculture), Subchapter C — SNAP", title: 7, parts: [...seq(271, 285), 292] } ] },
  { id: "MEDICAID", label: "Medicaid", structures: [
      { id: "MEDICAID-42C", label: "Title 42 (Public Health), Chapter IV (CMS), Subchapter C — Medical Assistance", title: 42, parts: seq(430, 456) },
      { id: "MEDICAID-42-CHIP", label: "Title 42 (Public Health), Chapter IV (CMS) — CHIP", title: 42, parts: [457] },
    ] },
  { id: "MEDICARE", label: "Medicare", structures: [
      { id: "MEDICARE-42B", label: "Title 42 (Public Health), Chapter IV (CMS), Subchapter B — Medicare Program", title: 42, parts: seq(405, 429) },
      { id: "MEDICARE-42G", label: "Title 42 (Public Health), Chapter IV (CMS), Subchapter G — Standards & Certification", title: 42, parts: seq(482, 498) },
    ] },
  { id: "ACA", label: "ACA Exchanges & Market Reforms", structures: [
      { id: "ACA-45B", label: "Title 45 (Public Welfare), Subchapter B — Access to Health Care", title: 45, parts: [144,146,147,148,150,153,154,155,156,157,158] },
      { id: "ACA-45A-1557", label: "Title 45 (Public Welfare), Subchapter A — Section 1557 Nondiscrimination", title: 45, parts: [92] },
      { id: "ACA-29-2590", label: "Title 29 (Labor), Part 2590 — Group Health Plan (DOL)", title: 29, parts: [2590] },
      { id: "ACA-26-54", label: "Title 26 (Internal Revenue), Part 54 — Group Health Plan (IRS)", title: 26, parts: [54] },
    ] },
  { id: "UI", label: "Unemployment Insurance / Benefits", structures: [ { id: "UI-20V", label: "Title 20 (Employees' Benefits), Chapter V — ETA", title: 20, parts: [601,602,603,604,606,609,614,615,616,617,618,619,620,625,640,650] } ] },
  { id: "FMLA", label: "Family and Medical Leave (FMLA)", structures: [ { id: "FMLA-29-825", label: "Title 29 (Labor), Part 825 — FMLA", title: 29, parts: [825] } ] },
];
const PART_LABELS: Record<string, Record<number, string>> = {
  "SNAP-7C": { 271:"General",273:"Certification",274:"Issuance",275:"Quality Control",278:"Retailers/Wholesalers",280:"Disaster",285:"Puerto Rico NAP",292:"Summer EBT" },
  "MEDICAID-42C": { 431:"State Admin",432:"State Personnel",438:"Managed Care",440:"Services—General",441:"Services—Limits",447:"Payments",456:"Utilization Control" },
  "MEDICAID-42-CHIP": { 457:"CHIP" },
  "MEDICARE-42B": { 415:"Physicians & Suppliers",422:"Medicare Advantage",423:"Part D",425:"MSSP (ACOs)" },
  "MEDICARE-42G": { 482:"Hospitals CoPs",483:"LTC Facilities",488:"Survey & Enforcement",489:"Provider Agreements",493:"CLIA" },
  "ACA-45B": { 144:"Definitions",146:"Market Reforms",147:"Group & Individual",150:"Enforcement",153:"3Rs",154:"Rate Review",155:"Exchanges",156:"Issuer Standards",157:"SHOP",158:"MLR" },
  "ACA-45A-1557": { 92:"Nondiscrimination" },
  "ACA-29-2590": { 2590:"Group Health Plan (DOL)" },
  "ACA-26-54": { 54:"Group Health Plan (IRS)" },
  "UI-20V": { 601:"Administrative Procedure",602:"Quality Control",603:"Confidentiality",604:"Able & Available",606:"FUTA Credits",609:"UCFE",614:"UCX",615:"Extended Benefits",616:"Interstate",617:"TAA—Benefits",618:"TAA—Eligibility",619:"Data Exchange",620:"Drug Testing",625:"Disaster UI",640:"Payment Promptness",650:"Appeals Promptness" },
  "FMLA-29-825": { 825:"FMLA" },
};
const getProgram = (id?: string) => PROGRAMS.find((p) => p.id === id) || PROGRAMS[0];
const getStructure = (progId?: string, structId?: string) => {
  const prog = getProgram(progId); return prog.structures.find((s) => s.id === structId) || prog.structures[0];
};
const partLabel = (structureId: string, part: number) => {
  const map = PART_LABELS[structureId] || {}; const desc = map[part];
  return desc ? `Part ${part} — ${desc}` : `Part ${part}`;
};

// Client-side CFR match helper
const matchesStructure = (doc: any, title: number, parts: number[]) => {
  const refs = Array.isArray(doc?.cfr_references) ? doc.cfr_references : [];
  return refs.some((r: any) => Number(r.title) === Number(title) && parts.includes(Number(r.part)));
};

// Fallback agency slugs per structure when expanding without CFR refs
const STRUCTURE_AGENCY_SLUGS: Record<string, string[]> = {
  "SNAP-7C": ["food-and-nutrition-service"],
  "MEDICAID-42C": ["centers-for-medicare-medicaid-services"],
  "MEDICAID-42-CHIP": ["centers-for-medicare-medicaid-services"],
  "MEDICARE-42B": ["centers-for-medicare-medicaid-services"],
  "MEDICARE-42G": ["centers-for-medicare-medicaid-services"],
  "ACA-45B": ["centers-for-medicare-medicaid-services"],
  "ACA-45A-1557": [],
  "ACA-29-2590": ["employee-benefits-security-administration"],
  "ACA-26-54": ["internal-revenue-service"],
  "UI-20V": ["employment-and-training-administration"],
  "FMLA-29-825": ["wage-and-hour-division"],
};
const getFallbackAgencies = (structureId?: string) => STRUCTURE_AGENCY_SLUGS[String(structureId || "")] || [];

// ------------------------------------------------ Federal Register fetchers ------------------------------------------------
async function fetchFR({ start, end, filters, skipCfrTitle = false, agencies }: { start: Date; end: Date; filters: any; skipCfrTitle?: boolean; agencies?: string[] }) {
  const [s, e] = normRange(start, end);
  const fields = ["publication_date","effective_on","type","title","document_number","html_url","agencies","cfr_references","action","abstract"];
  const baseParams: Record<string, any> = {
    per_page: 1000,
    order: "newest",
    "fields[]": fields,
    "conditions[publication_date][gte]": fmtDate(s),
    "conditions[publication_date][lte]": fmtDate(e),
    "conditions[type][]": ["RULE","PRORULE","PROPOSED_RULE","NOTICE","PRESDOCU"],
  };
  if (filters.topic && /^[a-z0-9-]+$/.test(filters.topic)) baseParams["conditions[topics][]"] = filters.topic;
  if (Array.isArray(agencies) && agencies.length) baseParams["conditions[agencies][]"] = agencies;
  if (filters.cfrTitle && !skipCfrTitle) {
    baseParams["conditions[cfr][title]"] = String(filters.cfrTitle);
    if (filters.cfrPart) baseParams["conditions[cfr][part]"] = String(filters.cfrPart);
  }
  const all: any[] = []; const seen = new Set<string>();
  let page = 1, totalPages = Infinity; const HARD_MAX = 100;
  while (page <= totalPages && page <= HARD_MAX) {
    const url = `${FR_BASE}/documents.json?${toQuery({ ...baseParams, page })}`;
    const r = await fetch(url);
    if (!r.ok) { let detail = ""; try { detail = await r.text(); } catch {} throw new Error(`FR fetch failed (${r.status})${detail ? `: ${detail.slice(0, 300)}` : ""}`); }
    const data = await r.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    for (const d of results) {
      const key = String(d.document_number || `${d.type}|${d.title}`);
      if (seen.has(key)) continue; seen.add(key);
      all.push({ ...d, _pub: d.publication_date ? new Date(`${d.publication_date}T00:00:00`) : null }); // local midnight to avoid TZ left-shift
    }
    totalPages = Number.isFinite(+data?.total_pages) && +data.total_pages > 0 ? +data.total_pages : totalPages;
    if (results.length < 1000) break; page += 1;
  }
  return all;
}
async function fetchFRSpan(opts: { start: Date; end: Date; filters: any; skipCfrTitle?: boolean; agencies?: string[] }) {
  const [s, e] = normRange(opts.start, opts.end);
  if (+e - +s < 1000 * 60 * 60 * 24 * 548) return fetchFR(opts);
  const edges = d3.timeYear.range(d3.timeYear.floor(s), d3.timeYear.offset(d3.timeYear.floor(e), 1));
  const out: any[] = []; const seen = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i]; const b = i + 1 < edges.length ? edges[i + 1] : d3.timeYear.offset(a, 1);
    const batch = await fetchFR({ ...opts, start: new Date(Math.max(+s, +a)), end: new Date(Math.min(+e, +d3.timeDay.offset(b, -1))) });
    for (const d of batch) { const k = String(d.document_number || `${d.type}|${d.title}`); if (seen.has(k)) continue; seen.add(k); out.push(d); }
  }
  return out;
}

// ------------------------------------------------ Component ------------------------------------------------
export default function SnapPolicyTimeline() {
  // Dates & view
  const [start, setStart] = useState(() => d3.timeYear.offset(new Date(), -6));
  const [end, setEnd] = useState(() => new Date());
  const [zoomUnit, setZoomUnit] = useState("months");
  const [bucket, setBucket] = useState(true);

  // Filters
  const [filters, setFilters] = useState({ topic: "", programArea: PROGRAMS[0].id, structureId: PROGRAMS[0].structures[0].id, cfrTitle: PROGRAMS[0].structures[0].title as any, cfrPart: "" });
  const program = useMemo(() => getProgram(filters.programArea), [filters.programArea]);
  const structure = useMemo(() => getStructure(filters.programArea, filters.structureId), [filters.programArea, filters.structureId]);
  useEffect(() => { const s = getStructure(filters.programArea, filters.structureId); if (filters.cfrTitle !== s.title) setFilters((f) => ({ ...f, cfrTitle: s.title, cfrPart: "" })); }, [filters.programArea, filters.structureId]);

  // Data & UI state
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<{ PRORULE: boolean; RULE: boolean; NOTICE: boolean; PRESDOCU: boolean }>({ PRORULE: true, RULE: true, NOTICE: true, PRESDOCU: true });
  const [includeNoCfr, setIncludeNoCfr] = useState(false);
  const [showNoCfrHelp, setShowNoCfrHelp] = useState(false);
  const [showLegendHelp, setShowLegendHelp] = useState(false);
  const [active, setActive] = useState<Date | null>(null);
  const [bucketLoading, setBucketLoading] = useState(false);
  const [modalDoc, setModalDoc] = useState<any | null>(null);

  // Scroll target for the secondary table
  const tableRef = useRef<HTMLDivElement | null>(null);

  // Reset no-CFR toggle if a specific part is chosen; also hide its tooltip
  useEffect(() => { if (filters.cfrPart) { setIncludeNoCfr(false); setShowNoCfrHelp(false); } }, [filters.cfrPart]);

  const visibleDocs = useMemo(() => (docs || []).filter((d: any) => { const k = normalizeDocType(d?.type) as keyof typeof enabledTypes | null; return k ? Boolean(enabledTypes[k]) : false; }), [docs, enabledTypes]);

  // Fetch logic
  const load = async (opts?: { includeNoCfrOverride?: boolean }) => {
    setError(""); setLoading(true);
    try {
      const include = opts?.includeNoCfrOverride ?? includeNoCfr;
      // A) Primary (CFR-scoped)
      const primary = await fetchFR({ start, end, filters, skipCfrTitle: false });
      let interim = primary;
      // Narrow to selected structure's parts when All parts is selected
      if (filters.cfrTitle && !filters.cfrPart) {
        try {
          const s = structure; const parts = Array.isArray(s?.parts) ? s.parts : [];
          if (parts.length) interim = primary.filter((d: any) => { const refs = Array.isArray(d?.cfr_references) ? d.cfr_references : []; if (!refs.length) return false; return matchesStructure(d, Number(s.title), parts); });
        } catch {}
      }
      let combined = interim.slice();
      // B) Optional no-CFR expansion via agencies when All parts
      if (filters.cfrTitle && !filters.cfrPart && include) {
        const agencySet = new Set<string>();
        for (const d of interim) (Array.isArray(d?.agencies) ? d.agencies : []).forEach((a: any) => { if (a?.slug) agencySet.add(String(a.slug)); });
        if (agencySet.size === 0) getFallbackAgencies(filters.structureId).forEach((slug) => agencySet.add(slug));
        const extra = await fetchFRSpan({ start, end, filters, skipCfrTitle: true, agencies: Array.from(agencySet) });
        const seen = new Set(combined.map((d: any) => String(d.document_number || `${d.type}|${d.title}`)));
        for (const d of extra) { const key = String(d.document_number || `${d.type}|${d.title}`); if (seen.has(key)) continue; seen.add(key); combined.push(d); }
        // Keep all no-ref docs; keep only structure-matching ref'd docs
        try { const s = structure; const parts = Array.isArray(s?.parts) ? s.parts : []; combined = combined.filter((d: any) => { const refs = Array.isArray(d?.cfr_references) ? d.cfr_references : []; if (refs.length === 0) return true; return matchesStructure(d, Number(s.title), parts); }); } catch {}
      }
      setDocs(combined);
    } catch (e: any) { setError(String(e?.message || e)); } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* initial */ }, []);

  // ------------------------------------------------ Series & buckets ------------------------------------------------
  const series = useMemo(() => {
    const [s, e] = normRange(start, end);
    const { iv } = tickCfg(zoomUnit); const interval = bucket ? iv : d3.timeDay;
    const s0 = d3.timeDay.floor(s), e0 = d3.timeDay.floor(e);
    let bins = interval.range(interval.floor(s0), interval.offset(interval.floor(e0), 1));
    if (!bins?.length) bins = [interval.floor(s0)];
    const key = d3.timeFormat("%Y-%m-%d");
    const init = () => ({ pr: 0, ru: 0, no: 0, pd: 0 });
    const map = new Map<string, { pr: number; ru: number; no: number; pd: number }>(bins.map((dt) => [key(dt), init()]));
    for (const doc of docs || []) {
      if (!doc || !doc._pub) continue; const kind = normalizeDocType(doc.type) as "PRORULE"|"RULE"|"NOTICE"|"PRESDOCU"|null; if (!kind) continue; if (!enabledTypes[kind]) continue;
      const k = key(interval.floor(doc._pub)); const base = map.get(k) || init();
      const cur = { pr: +base.pr||0, ru: +base.ru||0, no: +base.no||0, pd: +base.pd||0 };
      if (kind === "PRORULE") cur.pr += 1; else if (kind === "RULE") cur.ru += 1; else if (kind === "NOTICE") cur.no += 1; else if (kind === "PRESDOCU") cur.pd += 1;
      map.set(k, cur);
    }
    return bins.map((dt) => { const c = map.get(key(dt)) || init(); const pr = +c.pr||0, ru=+c.ru||0, no=+c.no||0, pd=+c.pd||0; return { date: dt, pr, ru, no, pd, tot: pr+ru+no+pd }; });
  }, [docs, start, end, zoomUnit, bucket, enabledTypes]);

  // Precompute bucket → docs (parity with chart)
  const bucketMap = useMemo(() => {
    const { iv } = tickCfg(zoomUnit); const interval = bucket ? iv : d3.timeDay; const map = new Map<number, any[]>();
    for (const d of docs || []) { if (!d || !d._pub) continue; const kType = normalizeDocType(d.type) as keyof typeof enabledTypes | null; if (!kType || !enabledTypes[kType]) continue; const k = +interval.floor(d._pub); const arr = map.get(k); if (arr) arr.push(d); else map.set(k, [d]); }
    return map;
  }, [docs, zoomUnit, bucket, enabledTypes]);
  const bucketDocs = useMemo(() => {
    if (!active) return [] as any[]; const { iv } = tickCfg(zoomUnit); const interval = bucket ? iv : d3.timeDay; const key = +interval.floor(active);
    const arr = bucketMap.get(key) || []; return arr.slice().sort((a: any, b: any) => String(a.type).localeCompare(String(b.type)));
  }, [active, bucketMap, zoomUnit, bucket]);
  useEffect(() => { if (!active) { setBucketLoading(false); return; } if (bucketLoading) { const id = requestAnimationFrame(() => setBucketLoading(false)); return () => cancelAnimationFrame(id); } }, [active, bucketDocs.length, bucketLoading]);

  // Auto-scroll to table when a bucket/day is selected
  useEffect(() => {
    if (active && tableRef.current) {
      try { tableRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch { tableRef.current.scrollIntoView(); }
    }
  }, [active]);

  // ------------------------------------------------ Chart (D3) ------------------------------------------------
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return; const wrap = d3.select(el);
    const bbox = el.getBoundingClientRect(); const width = Math.max(320, bbox.width || 0);
    const H = 240; const M = { t: 16, r: 16, b: 56, l: 40 };
    const drawSeries = (Array.isArray(series) ? series : []).filter((r) => r && r.date && !isNaN(+r.date)).map((r) => ({ date: r.date, pr:+r.pr||0, ru:+r.ru||0, no:+r.no||0, pd:+r.pd||0, tot:+r.tot||0 }));
    wrap.selectAll("svg").remove();
    const svg = wrap.append("svg").attr("viewBox", `0 0 ${width} ${H + M.t + M.b}`);
    const g = svg.append("g").attr("transform", `translate(${M.l},${M.t})`);
    const chartW = width - M.l - M.r, chartH = H;
    const x = d3.scaleTime().domain(normRange(start, end)).range([0, chartW]);
    const yMaxData = d3.max(drawSeries, (d) => d?.tot ?? 0) ?? 0; const y = d3.scaleLinear().domain([0, Math.max(1, yMaxData)]).range([H, 0]);
    // clip area to prevent bleed
    const clipId = `clip-${Math.random().toString(36).slice(2)}`;
    svg.append("defs").append("clipPath").attr("id", clipId).attr("clipPathUnits","userSpaceOnUse").append("rect").attr("x",0).attr("y",0).attr("width",chartW).attr("height",chartH);
    const plot = g.append("g").attr("clip-path", `url(#${clipId})`);

    const { iv, fmt } = tickCfg(zoomUnit);
    const ax = d3.axisBottom(x).ticks(iv.every(1)).tickFormat(d3.timeFormat(fmt));
    const xGridG = g.append("g").attr("transform", `translate(0,${H})`).call(d3.axisBottom(x).ticks(iv.every(1)).tickSize(-chartH).tickFormat("") as any);
    xGridG.attr("opacity", 0.08).selectAll("line").attr("stroke", "currentColor"); xGridG.selectAll("text").remove();
    const axG = g.append("g").attr("transform", `translate(0,${H})`).call(ax);
    axG.selectAll("text").attr("text-anchor", "end").attr("transform", "rotate(-45)").attr("dx", "-0.5em").attr("dy", "0.25em");
    const yMax = Math.ceil(y.domain()[1]); const yStep = Math.max(1, Math.ceil(yMax / 6)); const yVals = d3.range(0, yMax + 1, yStep);
    g.append("g").call(d3.axisLeft(y).tickValues(yVals).tickFormat(d3.format("d")));
    g.append("g").call(d3.axisLeft(y).tickValues(yVals).tickSize(-chartW).tickFormat("")).attr("opacity", 0.08).selectAll("line").attr("stroke", "currentColor");
    if (!drawSeries.length || drawSeries.every((d) => (d?.tot ?? 0) === 0)) { g.append("text").attr("x",8).attr("y",16).attr("class","text-xs fill-current").text("No data for selected document types — adjust filters, types, or dates, then Update."); return; }

    const keys = ["pr","ru","no","pd"] as const;
    const stacked = d3.stack<any>().keys(keys)(drawSeries);
    const area = d3.area<any>().x((d) => x(d.data.date)).y0((d) => y(d[0])).y1((d) => y(d[1]));
    const color = d3.scaleOrdinal<string, string>().domain(keys as any).range(["#2563eb","#93c5fd","#9ca3af","#f97316"]);
    plot.selectAll("path.stacked").data(stacked).join("path").attr("class","stacked").attr("d", area).attr("fill", (d: any) => color(d.key)).attr("fill-opacity", 0.6);

    // hover + click
    const bisect = d3.bisector((d: any) => d.date).left;
    const focus = plot.append("g").style("display","none");
    focus.append("line").attr("y1",0).attr("y2",chartH).attr("stroke","#d1d5db").attr("stroke-width",1).attr("opacity",0.9);
    const txt = focus.append("text").attr("class","text-xs fill-current").attr("dy",-8);
    const dot = focus.append("circle").attr("r",3.5).attr("fill","#111827").attr("stroke","white").attr("stroke-width",1.5).attr("cx",0).attr("cy", y(0)).style("pointer-events","none");

    const overlay = g.append("rect").attr("x",0).attr("y",0).attr("width",chartW).attr("height",chartH).attr("fill","transparent");
    const move = (ev: any) => {
      if (!drawSeries.length) return; const [mx,my] = d3.pointer(ev, g.node() as any);
      const cx = Math.max(0, Math.min(chartW, mx)); const cy = Math.max(0, Math.min(chartH, my));
      const x0 = x.invert(cx); let i = Math.max(0, Math.min(drawSeries.length - 1, bisect(drawSeries, x0)));
      if (i > 0 && i < drawSeries.length) { const dL = Math.abs(+x0 - +drawSeries[i-1].date); const dR = Math.abs(+x0 - +drawSeries[i].date); if (dL < dR) i = i - 1; }
      const row = drawSeries[i]; if (!row) return; const cxSnap = x(row.date);
      focus.style("display", null).attr("transform", `translate(${cxSnap},0)`); dot.attr("cy", y(row.tot));
      const right = cxSnap > chartW * 0.66;
      txt.attr("text-anchor", right ? "end" : "start").attr("x", right ? -8 : 8).attr("y", Math.max(12, Math.min(chartH - 8, cy)))
        .text(`${fmtDate(row.date)}: total ${row.tot} (Proposed Rule ${row.pr}, Rule ${row.ru}, Notice ${row.no}, Presidential ${row.pd})`);
    };
    overlay.on("mousemove", move).on("mouseleave", () => focus.style("display","none"));
    overlay.on("click", (ev: any) => {
      if (!drawSeries.length) return; const [mx] = d3.pointer(ev, g.node() as any);
      const cx = Math.max(0, Math.min(chartW, mx)); const x0 = x.invert(cx);
      let i = Math.max(0, Math.min(drawSeries.length - 1, bisect(drawSeries, x0)));
      if (i > 0 && i < drawSeries.length) { const dL = Math.abs(+x0 - +drawSeries[i-1].date); const dR = Math.abs(+x0 - +drawSeries[i].date); if (dL < dR) i = i - 1; }
      setBucketLoading(true); setActive(drawSeries[i]?.date || null);
    });

    // Legend (color keys only — info moved to tooltip by checkboxes)
    const L = g.append("g").attr("transform", `translate(${width - M.l - M.r - 260},8)`);
    [["Proposed Rule","#2563eb"],["Rule","#93c5fd"],["Notice","#9ca3af"],["Presidential Document","#f97316"]].forEach((it, i) => {
      const row = L.append("g").attr("transform", `translate(0,${i*16})`);
      row.append("rect").attr("x",0).attr("y",3).attr("width",18).attr("height",8).attr("fill", it[1]).attr("fill-opacity",0.6);
      row.append("text").attr("x",24).attr("y",10).attr("class","text-xs fill-current").text(it[0]);
    });
  }, [docs, start, end, zoomUnit, bucket, series, enabledTypes]);

  // ------------------------------------------------ UI ------------------------------------------------
  return (
    <div className="w-full p-4 space-y-4">
      <h1 className="text-xl font-semibold">Federal Register Policy Explorer</h1>
      {HEADER_CONTENT.map((item, i) => (
        item == null ? null : (
          typeof item === 'string'
            ? <div key={i} className="text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: item }} />
            : <React.Fragment key={i}>{item}</React.Fragment>
        )
      ))}

      {/* Time & view controls */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="text-xs">Start</label>
          <input className="w-full border rounded px-2 py-1" type="date" value={fmtDate(start)} onChange={(e)=>setStart(new Date(e.target.value+"T00:00:00"))} />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs">End</label>
          <input className="w-full border rounded px-2 py-1" type="date" value={fmtDate(end)} onChange={(e)=>setEnd(new Date(e.target.value+"T00:00:00"))} />
        </div>
        <div>
          <label className="text-xs">Zoom</label>
          <select className="w-full border rounded px-2 py-1" value={zoomUnit} onChange={(e)=>setZoomUnit(e.target.value)}>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
        </div>
        <div className="flex gap-2 items-center">
          <input id="bucket" type="checkbox" checked={bucket} onChange={(e)=>setBucket(e.target.checked)} />
          <label htmlFor="bucket" className="text-xs">Aggregate by Zoom unit</label>
        </div>
      </div>

      {/* Program filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-xs">Program Area</label>
          <select className="w-full border rounded px-2 py-1" value={filters.programArea} onChange={(e)=>{ const prog = getProgram(e.target.value); const first = prog.structures[0]; setFilters(f => ({ ...f, programArea: prog.id, structureId: first.id, cfrTitle: first.title, cfrPart: "" })); }}>
            {PROGRAMS.map((p)=> (<option key={p.id} value={p.id}>{p.label}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs">Title / Chapter / Subchapter</label>
          <select className="w-full border rounded px-2 py-1" value={filters.structureId} onChange={(e)=>{ const sId = e.target.value; const s = getStructure(filters.programArea, sId); setFilters(f => ({ ...f, structureId: sId, cfrTitle: s.title, cfrPart: "" })); }}>
            {program.structures.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
          </select>
        </div>
        <div>
          <label className="text-xs">Part</label>
          <select className="w-full border rounded px-2 py-1" value={filters.cfrPart} onChange={(e)=>setFilters({ ...filters, cfrPart: e.target.value })}>
            <option value="">All parts</option>
            {structure.parts.map((p) => (<option key={p} value={String(p)}>{partLabel(structure.id, p)}</option>))}
          </select>
        </div>
      </div>

      {/* Include no-CFR-refs (only when All parts) */}
      <div className={`flex items-center gap-2 relative ${filters.cfrPart ? 'hidden' : ''}`}>
        <input id="toggle-nocfr" type="checkbox" checked={includeNoCfr} onChange={(e)=>{ const v = e.target.checked; setIncludeNoCfr(v); if (filters.cfrTitle && !filters.cfrPart) { load({ includeNoCfrOverride: v }); } }} />
        <label htmlFor="toggle-nocfr" className="text-xs">Include docs without CFR references (only when Part = "All parts")</label>
        <button type="button" className="ml-1 inline-flex items-center justify-center h-5 w-5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer" aria-label="What does this do?" aria-expanded={showNoCfrHelp} onClick={()=>setShowNoCfrHelp(v=>!v)}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16Zm0-11a1 1 0 110-2 1 1 0 010 2Zm-1 2.5a 1 1 0 112 0V14a1 1 0 11-2 0v-4.5Z" clipRule="evenodd" /></svg>
        </button>
        {showNoCfrHelp && (
          <div className="absolute left-0 top-full mt-2 z-20 w-[min(28rem,92vw)] rounded border bg-white shadow p-3 text-xs">
            <p className="mb-1"><b>Include docs without CFR references</b> expands results when <i>Part = All parts</i>:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Adds documents in range from related agencies even if they lack CFR citations.</li>
              <li>Keeps all no‑CFR docs; keeps CFR‑cited docs only if they match the selected Title/parts.</li>
              <li>Helpful for older items, Notices, or Presidential docs that often omit CFR refs.</li>
            </ul>
          </div>
        )}
      </div>

      {/* Type checkboxes + tooltip */}
      <div className="flex flex-wrap items-center gap-3 text-xs relative">
        <span className="font-medium">Document types:</span>

        <label className="flex items-center gap-1"><input type="checkbox" checked={enabledTypes.PRORULE} onChange={(e)=>setEnabledTypes(v=>({ ...v, PRORULE: e.target.checked }))} /> Proposed Rule</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={enabledTypes.RULE} onChange={(e)=>setEnabledTypes(v=>({ ...v, RULE: e.target.checked }))} /> Rule</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={enabledTypes.NOTICE} onChange={(e)=>setEnabledTypes(v=>({ ...v, NOTICE: e.target.checked }))} /> Notice</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={enabledTypes.PRESDOCU} onChange={(e)=>setEnabledTypes(v=>({ ...v, PRESDOCU: e.target.checked }))} /> Presidential Document</label>
        <button type="button" className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 cursor-pointer" aria-label="Document type definitions" aria-expanded={showLegendHelp} onClick={()=>setShowLegendHelp(v=>!v)}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16Zm0-11a 1 1 0 110-2 1 1 0 010 2Zm-1 2.5a 1 1 0 112 0V14a1 1 0 11-2 0v-4.5Z" clipRule="evenodd" /></svg>
        </button>
        {showLegendHelp && (
          <div className="absolute left-0 top-full mt-2 z-20 w-[min(28rem,92vw)] rounded border bg-white shadow p-3 text-xs">
            <p className="mb-1"><b>Document type definitions</b></p>
            <ul className="list-disc ml-5 space-y-1">
              <li><b>Proposed Rule</b>: Agency proposal (NPRM) seeking public comment.</li>
              <li><b>Rule</b>: Final agency action that amends the CFR (includes interim/direct finals).</li>
              <li><b>Notice</b>: Agency announcement; does not amend the CFR.</li>
              <li><b>Presidential Document</b>: Executive orders, proclamations, memoranda, etc.</li>
            </ul>
          </div>
        )}
      </div>

      {/* Errors + actions */}
      {error && <div className="text-xs text-red-600 border rounded p-2 bg-red-50 whitespace-pre-wrap">{error}</div>}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <button className="rounded px-4 py-1.5 text-base font-bold text-white bg-blue-900 hover:bg-blue-800 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed transition" onClick={load} disabled={loading} aria-busy={loading}>
          {loading ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
              <span>Loading…</span>
            </span>
          ) : (
            "Update"
          )}
        </button>
        <span>
          Showing {visibleDocs.length.toLocaleString()} of {docs.length.toLocaleString()} documents · Proposed Rule: {docs.filter((d)=>normalizeDocType(d.type)==="PRORULE").length}, Rule: {docs.filter((d)=>normalizeDocType(d.type)==="RULE").length}, Notice: {docs.filter((d)=>normalizeDocType(d.type)==="NOTICE").length}, Presidential: {docs.filter((d)=>normalizeDocType(d.type)==="PRESDOCU").length}
        </span>
      </div>

      {/* Chart */}
      <div className="relative"><div ref={ref} className="w-full" /></div>

      {/* Secondary table */}
      {active && (
        <div ref={tableRef} className="border rounded">
          <div className="px-3 py-2 text-sm bg-muted/40 flex items-center justify-between">
            <div>Documents on {fmtDate(active)} (publication date bucket; respects type filter)</div>
            <div className="flex items-center gap-2">
              {bucketLoading && (
                <svg className="animate-spin h-4 w-4 text-gray-600" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
              )}
              <button className="text-xs underline" onClick={()=>setActive(null)}>Clear</button>
            </div>
          </div>
          <div className="max-h-64 overflow-auto" aria-busy={bucketLoading}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Published</th>
                  <th className="px-3 py-2">Effective</th>
                </tr>
              </thead>
              <tbody>
                {bucketLoading && bucketDocs.length === 0 && (
                  <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-gray-500"><span className="inline-flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg> Loading…</span></td></tr>
                )}
                {bucketDocs.map((d: any) => (
                  <tr key={d.document_number} className="hover:bg-muted/30 cursor-pointer">
                    <td className="px-3 py-2">{normalizeDocType(d.type)==="PRORULE"?"Proposed Rule":normalizeDocType(d.type)==="RULE"?"Rule":normalizeDocType(d.type)==="NOTICE"?"Notice":"Presidential Document"}</td>
                    <td className="px-3 py-2"><a className="underline" href={frDocUrl(d) || d.html_url || "#"} onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); setModalDoc(d); }} role="button">{d.title}</a></td>
                    <td className="px-3 py-2">{d.publication_date}</td>
                    <td className="px-3 py-2">{d.effective_on || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {modalDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={()=>setModalDoc(null)} />
          <div role="dialog" aria-modal="true" className="relative z-10 bg-white rounded-lg shadow-xl max-w-2xl w-[92%] p-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold leading-tight">{modalDoc.title}</h2>
              <button className="text-sm px-2 py-1 border rounded" onClick={()=>setModalDoc(null)}>Close</button>
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <div><span className="font-medium">Type:</span> {normalizeDocType(modalDoc.type)==="PRORULE"?"Proposed Rule":normalizeDocType(modalDoc.type)==="RULE"?"Rule":normalizeDocType(modalDoc.type)==="NOTICE"?"Notice":"Presidential Document"}</div>
              <div><span className="font-medium">Agency:</span> {(Array.isArray(modalDoc.agencies) ? modalDoc.agencies.map((a: any)=>a.name).join(", ") : "—")}</div>
              <div><span className="font-medium">Action:</span> {modalDoc.action || "—"}</div>
              <div><span className="font-medium">Summary:</span> {modalDoc.summary || modalDoc.abstract || "—"}</div>
              <div className="pt-2">
                {frDocUrl(modalDoc) ? (
                  <a className="underline" href={frDocUrl(modalDoc)} target="_blank" rel="noopener noreferrer" onClick={(e)=>{ e.preventDefault(); e.stopPropagation(); const u = frDocUrl(modalDoc); if (u) { try { window.open(u, "_blank", "noopener,noreferrer"); } catch {} } }}>
                    Open on FederalRegister.gov
                  </a>
                ) : (
                  <span className="text-gray-500">Link not available</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
