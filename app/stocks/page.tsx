"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

// ---------- Types ----------
type Row = { ticker: string; name: string; sector: string; catalyst: string };
type SyncStatus = "off" | "on" | "joining" | "error";
type CandlePoint = { t: number; c: number }; // epoch ms, close
type TimeKey = "5D" | "1M" | "3M" | "1Y" | "5Y";

type SyncGet = { rows: Row[]; updatedAt: number };
type SyncPut = { ok: true } | { error: string };

type QuoteResp =
  | { price: number; change: number; changePct: number }
  | { price: null; change: number; changePct: number }
  | { error: string };

type QuoteMap = Record<
  string,
  { price: number | null; change: number; changePct: number }
>;

// ---------- Timeframe map for /api/candles ----------
const TIMEFRAMES: Record<TimeKey, { range: string; interval: string; label: string }> = {
  "5D": { range: "5d", interval: "15m", label: "5D" },
  "1M": { range: "1mo", interval: "1d", label: "1M" },
  "3M": { range: "3mo", interval: "1d", label: "3M" },
  "1Y": { range: "1y", interval: "1d", label: "1Y" },
  "5Y": { range: "5y", interval: "1wk", label: "5Y" },
};

// ---------- Helpers ----------
const clampTicker = (s: string) =>
  s.toUpperCase().trim().replace(/[^A-Z0-9.\-]/g, "").slice(0, 8);

function newCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[(Math.random() * chars.length) | 0];
  return out;
}

async function safeFetchJson<T>(input: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(input, { cache: "no-store", ...init });
    if (!r.ok) return null;
    const j = (await r.json()) as unknown;
    return j as T;
  } catch {
    return null;
  }
}

function toChart(points: CandlePoint[]): { time: string; price: number }[] {
  return points.map((p) => ({
    time: new Date(p.t).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    price: Number(p.c ?? 0),
  }));
}

function normalizeCandles(j: unknown): CandlePoint[] {
  // { t: number[], c: number[] }
  if (
    j &&
    typeof j === "object" &&
    "t" in (j as Record<string, unknown>) &&
    "c" in (j as Record<string, unknown>)
  ) {
    const o = j as { t?: unknown; c?: unknown };
    if (Array.isArray(o.t) && Array.isArray(o.c) && o.t.length === o.c.length) {
      const out: CandlePoint[] = [];
      for (let i = 0; i < o.t.length; i++) {
        const ts = Number(o.t[i]);
        const cl = Number(o.c[i]);
        if (Number.isFinite(ts) && Number.isFinite(cl)) out.push({ t: ts, c: cl });
      }
      return out;
    }
  }
  // { points: [{t,c}] }
  if (j && typeof j === "object" && "points" in (j as Record<string, unknown>)) {
    const o = j as { points?: unknown };
    if (Array.isArray(o.points)) {
      const out: CandlePoint[] = [];
      for (const v of o.points) {
        if (v && typeof v === "object" && "t" in v && "c" in v) {
          const ts = Number((v as { t: unknown }).t);
          const cl = Number((v as { c: unknown }).c);
          if (Number.isFinite(ts) && Number.isFinite(cl)) out.push({ t: ts, c: cl });
        }
      }
      return out;
    }
  }
  // Array<{t,c}>
  if (Array.isArray(j)) {
    const out: CandlePoint[] = [];
    for (const v of j) {
      if (v && typeof v === "object" && "t" in v && "c" in v) {
        const ts = Number((v as { t: unknown }).t);
        const cl = Number((v as { c: unknown }).c);
        if (Number.isFinite(ts) && Number.isFinite(cl)) out.push({ t: ts, c: cl });
      }
    }
    return out;
  }
  return [];
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ---------- Page ----------
export default function StocksPage() {
  // Data
  const [rows, setRows] = useState<Row[]>([]);
  const [quotes, setQuotes] = useState<QuoteMap>({});

  // Inputs
  const [tickerIn, setTickerIn] = useState("");
  const [nameIn, setNameIn] = useState("");
  const [sectorIn, setSectorIn] = useState("");
  const [catIn, setCatIn] = useState("");

  // Chart
  const [selected, setSelected] = useState<string>("");
  const [tf, setTf] = useState<TimeKey>("3M");
  const [chart, setChart] = useState<CandlePoint[] | null>(null);
  const [chartMsg, setChartMsg] = useState<string>("Pick a stock to view a chart…");
  const [chartLoading, setChartLoading] = useState(false);

  // Sync
  const [syncId, setSyncId] = useState<string>("");
  const [joinCode, setJoinCode] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("off");
  const lastSeenRef = useRef<number>(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load stored sync code + rows locally
  useEffect(() => {
    try {
      const sid = localStorage.getItem("syncId");
      if (sid) setSyncId(sid.toUpperCase());
      const cache = localStorage.getItem("rows");
      if (cache) {
        const parsed = JSON.parse(cache) as Row[];
        if (Array.isArray(parsed)) setRows(parsed);
      }
    } catch {}
  }, []);

  // Persist rows locally
  useEffect(() => {
    try {
      localStorage.setItem("rows", JSON.stringify(rows));
    } catch {}
  }, [rows]);

  // Start/stop polling Upstash
  useEffect(() => {
    if (!syncId) {
      setSyncStatus("off");
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    setSyncStatus("joining");
    const url = `/api/sync?id=${encodeURIComponent(syncId)}`;

    (async () => {
      const j = await safeFetchJson<SyncGet>(url);
      if (!j || !Array.isArray(j.rows)) {
        setSyncStatus("error");
        return;
      }
      setRows(j.rows);
      lastSeenRef.current = Number(j.updatedAt || 0);
      setSyncStatus("on");
    })();

    pollRef.current = setInterval(async () => {
      const j = await safeFetchJson<SyncGet>(url);
      if (!j || typeof j.updatedAt !== "number") {
        setSyncStatus("error");
        return;
      }
      if (j.updatedAt > lastSeenRef.current) {
        lastSeenRef.current = j.updatedAt;
        if (Array.isArray(j.rows)) setRows(j.rows);
      }
      setSyncStatus("on");
    }, 10_000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [syncId]);

  // Push local changes to cloud when rows change and sync is on
  useEffect(() => {
    const doPut = async () => {
      if (!syncId || syncStatus === "off" || syncStatus === "error") return;
      const r = await safeFetchJson<SyncPut>(`/api/sync?id=${encodeURIComponent(syncId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      if (!r || ("error" in r && r.error)) setSyncStatus("error");
      else setSyncStatus("on");
    };
    const t = setTimeout(doPut, 300);
    return () => clearTimeout(t);
  }, [rows, syncId, syncStatus]);

  // Quotes: fetch on load and every 20s for current rows
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    async function fetchQuotes() {
      if (!rows.length) {
        setQuotes({});
        return;
      }
      const symbols = rows.map((r) => r.ticker);
      const next: QuoteMap = {};
      const tasks = symbols.map(async (sym) => {
        const q = await safeFetchJson<QuoteResp>(`/api/quote?symbol=${encodeURIComponent(sym)}`);
        if (!q || "error" in q) {
          next[sym] = { price: null, change: 0, changePct: 0 };
        } else {
          next[sym] = { price: q.price, change: q.change, changePct: q.changePct };
        }
      });
      await Promise.all(tasks);
      setQuotes(next);
    }

    fetchQuotes();
    timer = setInterval(fetchQuotes, 20_000);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [rows]);

  // Chart loader when selected or timeframe changes
  useEffect(() => {
    if (!selected) {
      setChart(null);
      setChartMsg("Pick a stock to view a chart…");
      return;
    }
    const { range, interval } = TIMEFRAMES[tf];
    const url = `/api/candles?symbol=${encodeURIComponent(selected)}&range=${range}&interval=${interval}`;
    setChartLoading(true);
    setChartMsg("Loading…");
    (async () => {
      const j = await safeFetchJson<unknown>(url);
      const pts = normalizeCandles(j);
      setChartLoading(false);
      if (!pts.length) {
        setChart(null);
        setChartMsg("No data for this timeframe (try another range or market hours).");
        return;
      }
      setChart(pts);
      setChartMsg("");
    })();
  }, [selected, tf]);

  const chartData = useMemo(() => toChart(chart ?? []), [chart]);

  // Actions
  function addRow() {
    const t = clampTicker(tickerIn);
    if (!t) return;
    const newRow: Row = {
      ticker: t,
      name: nameIn.trim() || t,
      sector: sectorIn.trim(),
      catalyst: catIn.trim(),
    };
    setRows((prev) => (prev.some((r) => r.ticker === t) ? prev : [newRow, ...prev]));
    setTickerIn("");
    setNameIn("");
    setSectorIn("");
    setCatIn("");
  }
  function removeRow(t: string) {
    setRows((prev) => prev.filter((r) => r.ticker !== t));
    if (selected === t) setSelected("");
  }
  function ensureSyncCode() {
    const code = syncId || newCode(8);
    setSyncId(code);
    try {
      localStorage.setItem("syncId", code);
    } catch {}
  }

  // ---------- Render ----------
  return (
    <div className="min-h-[100dvh] text-gray-100 bg-gradient-to-br from-[#0b1020] via-[#0f1b2e] to-[#0a0f1e]">
      <header className="px-5 sm:px-8 pt-6 pb-3 border-b border-white/10 bg-black/10 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6">
          <div className="flex-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              D6 Stock Tracker
            </h1>
            <p className="text-sm text-gray-400">
              Add tickers, see live prices, click to view charts, and link devices with a sync code.
            </p>
          </div>

          {/* Sync panel */}
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-3 grid gap-2 w-full sm:w-auto">
            <div className="text-xs text-gray-400">
              Sync status:{" "}
              {syncStatus === "on" ? (
                <span className="text-emerald-400">On</span>
              ) : syncStatus === "joining" ? (
                <span className="text-amber-300">Linking…</span>
              ) : syncStatus === "error" ? (
                <span className="text-rose-400">Error</span>
              ) : (
                <span className="text-gray-300">Off</span>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Your code:</span>
                <code className="text-sm text-white bg-white/10 rounded px-2 py-1">
                  {syncId || "—"}
                </code>
                <button
                  className="text-xs border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-2 py-1"
                  onClick={() => {
                    ensureSyncCode();
                    if (syncId) navigator.clipboard.writeText(syncId);
                  }}
                >
                  {syncId ? "Copy" : "Create"}
                </button>
              </div>

              <div className="flex gap-2">
                <input
                  className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-2 py-1"
                  placeholder="Use a Sync Code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                />
                <button
                  className="text-xs border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-2 py-1"
                  onClick={() => {
                    const code = joinCode.trim().toUpperCase();
                    if (!code) return;
                    setSyncId(code);
                    setJoinCode("");
                    try {
                      localStorage.setItem("syncId", code);
                    } catch {}
                  }}
                >
                  Link
                </button>
              </div>
            </div>

            <div className="text-[11px] text-gray-400">
              Tip: Paste the code into your phone to keep both in sync.
            </div>
          </div>
        </div>
      </header>

      <main className="px-5 sm:px-8 py-6">
        <div className="max-w-6xl mx-auto grid gap-6">
          {/* Add row */}
          <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur p-4 grid gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
              <input
                className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2"
                placeholder="Ticker (e.g., ACLS)"
                value={tickerIn}
                onChange={(e) => setTickerIn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRow()}
              />
              <input
                className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2"
                placeholder="Name"
                value={nameIn}
                onChange={(e) => setNameIn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRow()}
              />
              <input
                className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2"
                placeholder="Sector"
                value={sectorIn}
                onChange={(e) => setSectorIn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRow()}
              />
              <input
                className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2 col-span-2 sm:col-span-2"
                placeholder="Catalyst"
                value={catIn}
                onChange={(e) => setCatIn(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addRow()}
              />
            </div>
            <div className="flex justify-end">
              <button
                className="px-4 py-2 rounded-lg border border-emerald-400/30 text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/15"
                onClick={addRow}
              >
                Add
              </button>
            </div>
          </div>

          {/* Table (desktop) */}
          <div className="hidden md:block rounded-xl overflow-hidden border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-gray-300">
                <tr>
                  <th className="text-left px-4 py-2">Ticker</th>
                  <th className="text-left px-4 py-2">Name</th>
                  <th className="text-left px-4 py-2">Sector</th>
                  <th className="text-right px-4 py-2">Price</th>
                  <th className="text-right px-4 py-2">Change %</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {rows.map((r) => {
                  const q = quotes[r.ticker];
                  const pct = q?.changePct ?? 0;
                  const pctClass =
                    q && q.price != null
                      ? pct > 0
                        ? "text-emerald-300"
                        : pct < 0
                        ? "text-rose-300"
                        : "text-gray-300"
                      : "text-gray-400";
                  return (
                    <tr
                      key={r.ticker}
                      className={`hover:bg-white/5 ${selected === r.ticker ? "bg-white/10" : ""}`}
                    >
                      <td
                        className="px-4 py-2 cursor-pointer font-medium"
                        onClick={() => setSelected(r.ticker)}
                        title="Click to view chart"
                      >
                        {r.ticker}
                      </td>
                      <td className="px-4 py-2">{r.name}</td>
                      <td className="px-4 py-2">{r.sector}</td>
                      <td className="px-4 py-2 text-right">{fmt(q?.price)}</td>
                      <td className={`px-4 py-2 text-right ${pctClass}`}>
                        {q && q.price != null ? `${fmt(pct, 2)}%` : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          className="text-rose-300 hover:text-rose-200"
                          onClick={() => removeRow(r.ticker)}
                          title="Remove"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-gray-400" colSpan={6}>
                      No tickers yet — add one above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Cards (mobile) */}
          <div className="grid md:hidden gap-3">
            {rows.map((r) => {
              const q = quotes[r.ticker];
              const pct = q?.changePct ?? 0;
              const pctClass =
                q && q.price != null
                  ? pct > 0
                    ? "text-emerald-300"
                    : pct < 0
                    ? "text-rose-300"
                    : "text-gray-300"
                  : "text-gray-400";
              return (
                <div
                  key={r.ticker}
                  className={`rounded-xl border border-white/10 bg-white/5 p-3 ${selected === r.ticker ? "ring-1 ring-emerald-400/40" : ""}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{r.ticker}</div>
                    <div className="text-xs text-gray-400">{r.sector}</div>
                  </div>
                  <div className="text-sm text-gray-300">{r.name}</div>
                  {r.catalyst && <div className="text-sm text-gray-400">{r.catalyst}</div>}

                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-gray-200">Price: {fmt(q?.price)}</div>
                    <div className={`text-sm ${pctClass}`}>
                      {q && q.price != null ? `${fmt(pct, 2)}%` : "—"}
                    </div>
                  </div>

                  <div className="mt-3 flex gap-3">
                    <button
                      className="px-3 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10"
                      onClick={() => setSelected(r.ticker)}
                    >
                      Chart
                    </button>
                    <button
                      className="px-3 py-1 rounded border border-rose-400/30 text-rose-200 bg-rose-400/10 hover:bg-rose-400/15"
                      onClick={() => removeRow(r.ticker)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="text-center text-gray-400 py-8">
                No tickers yet — add one above to get started.
              </div>
            )}
          </div>

          {/* Chart panel */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-semibold">
                {selected ? `${selected} — Price Chart` : "Chart"}
              </div>
              <div className="flex gap-2">
                {(Object.keys(TIMEFRAMES) as TimeKey[]).map((k) => (
                  <button
                    key={k}
                    onClick={() => setTf(k)}
                    className={`px-3 py-1 rounded border ${
                      tf === k
                        ? "border-emerald-400/40 text-emerald-200 bg-emerald-400/10"
                        : "border-white/10 text-gray-200 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    {TIMEFRAMES[k].label}
                  </button>
                ))}
              </div>
            </div>

            {!selected && <div className="text-gray-400">{chartMsg}</div>}
            {selected && chartLoading && <div className="text-gray-400">{chartMsg}</div>}
            {selected && !chartLoading && chart && chart.length > 1 && (
              <div className="h-[280px] sm:h-[340px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeOpacity={0.15} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }}
                      tickMargin={8}
                    />
                    <YAxis
                      domain={["auto", "auto"]}
                      tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }}
                      tickMargin={8}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(0,0,0,0.7)",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                        color: "#fff",
                      }}
                    />
                    <Line type="monotone" dataKey="price" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            {selected && !chartLoading && (!chart || chart.length <= 1) && (
              <div className="text-gray-400">{chartMsg}</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
