"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

/* ========= Types ========= */
type TF = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y";
type Candle = { t: number; c: number };
type Quote = { price: number; change: number; changePct: number };
type Row = { ticker: string; name: string; sector: string; catalyst: string };

type QuoteResponse = { c?: number; d?: number; dp?: number };
type ProfileResponse = { name?: string; finnhubIndustry?: string };

/* ========= Config ========= */
const TIMEFRAMES: TF[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"];
const FINNHUB_REST = "https://finnhub.io/api/v1";

const STORAGE_KEY = "nightfallRows_v2"; // new key so old saved list doesn't auto-load
const LEGACY_KEY = "stocksRows";        // migrate once if present

/* ========= Utils ========= */
function isUSMarketOpenNow() {
  const now = new Date();
  const d = now.getUTCDay(); // 0 Sun..6 Sat
  if (d === 0 || d === 6) return false;
  const m = now.getUTCHours() * 60 + now.getUTCMinutes();
  return m >= 13 * 60 + 30 && m <= 20 * 60; // 9:30–16:00 ET
}
function fmt(n?: number, d = 2) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}
function isRow(v: unknown): v is Row {
  return !!v && typeof v === "object" && "ticker" in v;
}

/* ========= Data hooks ========= */
// Live quotes via Finnhub (poll every 60s in client)
function useFinnhubQuotes(symbols: string[]) {
  const token = process.env.NEXT_PUBLIC_FINNHUB_KEY;
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});

  useEffect(() => {
    if (!token || symbols.length === 0) return;
    let cancel = false;

    async function poll() {
      try {
        await Promise.all(
          symbols.map(async (sym) => {
            const r = await fetch(
              `${FINNHUB_REST}/quote?symbol=${encodeURIComponent(sym)}&token=${token}`
            );
            if (!r.ok) return;
            const q: QuoteResponse = await r.json();
            if (cancel) return;
            if (typeof q.c === "number") {
              const entry: Quote = {
                price: q.c,
                change: typeof q.d === "number" ? q.d : 0,
                changePct: typeof q.dp === "number" ? q.dp : 0,
              };
              setQuotes((prev) => ({ ...prev, [sym]: entry }));
            }
          })
        );
      } catch {
        // ignore transient errors
      }
    }

    poll();
    const id = setInterval(poll, 60_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [symbols, token]);

  return quotes;
}

// Company profile (name/sector when adding a ticker)
async function fetchProfile(symbol: string, token?: string) {
  if (!token) return null;
  try {
    const r = await fetch(
      `${FINNHUB_REST}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`
    );
    if (!r.ok) return null;
    const j: ProfileResponse = await r.json();
    if (!j || !j.name) return null;
    return { name: j.name || symbol, sector: j.finnhubIndustry || "—" };
  } catch {
    return null;
  }
}

// Candles via our server route (avoids CORS)
async function fetchCandlesRange(symbol: string, tf: TF): Promise<Candle[]> {
  try {
    const r = await fetch(
      `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`,
      { cache: "no-store" }
    );
    if (!r.ok) return [];
    const j: unknown = await r.json();
    const data = (j as { data?: Candle[] }).data;
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/* ========= Page ========= */
export default function StockTracker() {
  // Start EMPTY; user adds their own list
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [catalystInput, setCatalystInput] = useState("");

  const [selected, setSelected] = useState<{ ticker: string; name: string } | null>(null);
  const [tf, setTf] = useState<TF>("3M");

  const [chartCache, setChartCache] = useState<Record<string, Candle[]>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const token = process.env.NEXT_PUBLIC_FINNHUB_KEY;
  const symbols = useMemo(() => rows.map((r) => r.ticker), [rows]);
  const quotes = useFinnhubQuotes(symbols);

  /* Load saved list (new key), migrate legacy once */
  useEffect(() => {
    try {
      const rawNew = localStorage.getItem(STORAGE_KEY);
      if (rawNew) {
        const parsed: unknown = JSON.parse(rawNew);
        if (Array.isArray(parsed) && parsed.every(isRow)) {
          setRows(parsed);
          return;
        }
      }
      const rawOld = localStorage.getItem(LEGACY_KEY);
      if (rawOld) {
        const parsed: unknown = JSON.parse(rawOld);
        if (Array.isArray(parsed) && parsed.every(isRow)) {
          setRows(parsed);
        }
        localStorage.removeItem(LEGACY_KEY);
      }
    } catch {}
  }, []);

  /* Save list */
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  /* Load chart when selection/timeframe changes (with cache) */
  useEffect(() => {
    (async () => {
      if (!selected) return;
      const key = `${selected.ticker}_${tf}`;
      if (chartCache[key]?.length) return; // already have it

      setLoading(true);
      setMsg(null);
      try {
        const data = await fetchCandlesRange(selected.ticker, tf);
        if (!data.length) setMsg("No data for this timeframe (try another range or market hours).");
        setChartCache((p) => ({ ...p, [key]: data }));
      } catch {
        setMsg("Couldn’t load chart data (network).");
      } finally {
        setLoading(false);
      }
    })();
  }, [selected, tf, chartCache]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return rows.filter(
      (r) =>
        r.ticker.toLowerCase().includes(f) ||
        r.name.toLowerCase().includes(f) ||
        r.sector.toLowerCase().includes(f)
    );
  }, [filter, rows]);

  async function addSym() {
    const sym = tickerInput.trim().toUpperCase();
    if (!sym) return;
    if (rows.some((r) => r.ticker === sym)) {
      setTickerInput("");
      setCatalystInput("");
      return;
    }
    let name = sym;
    let sector = "—";
    const prof = await fetchProfile(sym, token);
    if (prof) {
      name = prof.name;
      sector = prof.sector;
    }
    setRows((prev) => [{ ticker: sym, name, sector, catalyst: catalystInput || "" }, ...prev]);
    setTickerInput("");
    setCatalystInput("");
  }
  function removeSym(sym: string) {
    setRows((prev) => prev.filter((r) => r.ticker !== sym));
    if (selected?.ticker === sym) setSelected(null);
  }
  function clearAll() {
    setRows([]);
    setSelected(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }

  const selectedKey = selected ? `${selected.ticker}_${tf}` : null;
  const detailData: Candle[] = selectedKey ? chartCache[selectedKey] || [] : [];

  /* ========= UI ========= */
  return (
    <div className="p-6 grid gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">D6 Stock Tracker</h1>
          <p className="text-sm text-gray-400 mt-1">
            {token
              ? isUSMarketOpenNow()
                ? "Live: quotes via Finnhub (60s) — Market open"
                : "Live: quotes via Finnhub (60s) — Market closed"
              : "Add NEXT_PUBLIC_FINNHUB_KEY in .env.local to enable live quotes"}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <input
            className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2 w-full sm:w-64"
            placeholder="Filter by ticker, name, sector"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-3 py-2"
            onClick={() => location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Add / Clear */}
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 grid gap-3">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-400">Ticker</label>
            <input
              className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2 w-full"
              placeholder="e.g., NVDA"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSym()}
            />
          </div>
          <div className="flex-[2]">
            <label className="text-xs text-gray-400">Catalyst (optional)</label>
            <input
              className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-3 py-2 w-full"
              placeholder="Why this stock?"
              value={catalystInput}
              onChange={(e) => setCatalystInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSym()}
            />
          </div>
          <div className="flex gap-2">
            <button className="bg-white/10 hover:bg-white/20 text-white rounded px-3 py-2" onClick={addSym}>
              Add
            </button>
            <button
              className="border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-3 py-2"
              onClick={clearAll}
            >
              Clear All
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-gray-300">
            <tr className="text-left">
              <th className="p-2">Ticker</th>
              <th className="p-2">Name</th>
              <th className="p-2">Price</th>
              <th className="p-2">Δ</th>
              <th className="p-2">Δ%</th>
              <th className="p-2">Sector</th>
              <th className="p-2">Catalyst</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody className="text-gray-200">
            {filtered.map((s) => {
              const q = quotes[s.ticker];
              const up = (q?.change ?? 0) >= 0;
              return (
                <tr key={s.ticker} className="border-t border-white/10">
                  <td className="p-2 font-semibold text-white">{s.ticker}</td>
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">{fmt(q?.price)}</td>
                  <td className={`p-2 ${up ? "text-emerald-400" : "text-rose-400"}`}>{fmt(q?.change)}</td>
                  <td className={`p-2 ${up ? "text-emerald-400" : "text-rose-400"}`}>{fmt(q?.changePct)}</td>
                  <td className="p-2">{s.sector}</td>
                  <td className="p-2 min-w-[220px]">
                    <input
                      className="border border-white/10 bg-white/5 text-gray-100 placeholder:text-gray-400 rounded px-2 py-1 w-full"
                      value={s.catalyst}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) => (r.ticker === s.ticker ? { ...r, catalyst: e.target.value } : r))
                        )
                      }
                    />
                  </td>
                  <td className="p-2 space-x-2">
                    <button
                      className="border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-2 py-1"
                      onClick={() => {
                        setTf("3M");
                        setSelected({ ticker: s.ticker, name: s.name });
                      }}
                    >
                      View
                    </button>
                    <button
                      className="border border-white/10 bg-white/5 hover:bg-white/10 text-white rounded px-2 py-1"
                      onClick={() => removeSym(s.ticker)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="p-4 text-gray-400" colSpan={8}>
                  No stocks yet — add a ticker above to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail chart */}
      {selected && (
        <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur p-4 grid gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-lg font-semibold text-white">
                {selected.ticker} — {rows.find((r) => r.ticker === selected.ticker)?.name || selected.name}
              </div>
              <div className="text-sm text-gray-400">
                {rows.find((r) => r.ticker === selected.ticker)?.sector || ""}
              </div>
            </div>
            <div className="flex gap-2">
              {TIMEFRAMES.map((k) => (
                <button
                  key={k}
                  className={`px-2 py-1 rounded border border-white/10 ${
                    tf === k ? "bg-white/20 text-white" : "bg-white/5 hover:bg-white/10 text-gray-200"
                  }`}
                  onClick={() => setTf(k)}
                >
                  {k}
                </button>
              ))}
              <button
                className="px-2 py-1 rounded border border-white/10 bg-white/5 hover:bg-white/10 text-white"
                onClick={() => setSelected(null)}
              >
                Close
              </button>
            </div>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={detailData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(ts) => new Date(Number(ts)).toLocaleDateString()}
                  stroke="#334155"
                  tick={{ fill: "#cbd5e1", fontSize: 12 }}
                />
                <YAxis domain={["auto", "auto"]} width={60} stroke="#334155" tick={{ fill: "#cbd5e1", fontSize: 12 }} />
                <Tooltip
                  formatter={(v: number) => fmt(Number(v))}
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                  contentStyle={{
                    background: "rgba(17, 24, 39, 0.9)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e5e7eb",
                  }}
                />
                <Line type="monotone" dataKey="c" dot={false} strokeWidth={2} stroke="#ffffff" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="text-xs text-gray-400">
            {selected.ticker} {tf} • points: {detailData.length}
          </div>

          {loading && <div className="text-sm text-gray-400">Loading chart…</div>}
          {!loading && msg && <div className="text-sm text-gray-400">{msg}</div>}
        </div>
      )}

      <div className="text-xs text-gray-500">Your list saves in this browser. Prices may be delayed.</div>
    </div>
  );
}
