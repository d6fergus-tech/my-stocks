"use client";

import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";

/* ========= Types & Config ========= */
type Candle = { t: number; c: number };
type TF = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y";

type QuoteResponse = { c?: number; d?: number; dp?: number };
type ProfileResponse = { name?: string; finnhubIndustry?: string };

const DEFAULT_STOCKS = [
  { ticker: "ACLS", name: "Axcelis", sector: "Semis / AI", catalyst: "Chip capex orders 2025" },
  { ticker: "MTSI", name: "MACOM", sector: "Semis / AI networking", catalyst: "High GM guidance" },
  { ticker: "SITM", name: "SiTime", sector: "Semis / timing", catalyst: ">40% growth guide" },
  { ticker: "AMKR", name: "Amkor", sector: "Advanced packaging", catalyst: "TSMC AZ build" },
  { ticker: "COHR", name: "Coherent", sector: "Optics / materials", catalyst: "Diamond-SiC launch" },
  { ticker: "OLLI", name: "Ollie's Bargain Outlet", sector: "Retail (off-price)", catalyst: "Raised outlook" },
  { ticker: "PATK", name: "Patrick Industries", sector: "Cyclicals", catalyst: "RV recovery" },
  { ticker: "GSHD", name: "Goosehead Insurance", sector: "Insurance (franchise)", catalyst: "Franchise growth" },
  { ticker: "INMD", name: "InMode", sector: "Med-tech", catalyst: "Rerating potential" },
  { ticker: "TRMD", name: "TORM", sector: "Shipping", catalyst: "High tanker rates" },
];

const TIMEFRAMES: TF[] = ["1D", "5D", "1M", "3M", "6M", "1Y", "5Y"];
const FINNHUB_REST = "https://finnhub.io/api/v1";

/* ========= Helpers ========= */
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

/* ========= Data fetchers ========= */
// Quotes via Finnhub (REST polling every 60s)
function useFinnhubQuotes(symbols: string[]) {
  const token = process.env.NEXT_PUBLIC_FINNHUB_KEY;
  const [quotes, setQuotes] = useState<Record<string, { price: number; change: number; changePct: number }>>({});
  useEffect(() => {
    if (!token || symbols.length === 0) return;
    let cancel = false;

    async function poll() {
      try {
        await Promise.all(
          symbols.map(async (sym) => {
            const r = await fetch(`${FINNHUB_REST}/quote?symbol=${encodeURIComponent(sym)}&token=${token}`);
            if (!r.ok) return;
            const q: QuoteResponse = await r.json();
            if (!cancel && typeof q.c === "number") {
              setQuotes((prev) => ({
                ...prev,
                [sym]: { price: q.c, change: q.d ?? 0, changePct: q.dp ?? 0 },
              }));
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
  }, [symbols, token]); // include 'symbols' directly to satisfy ESLint

  return quotes;
}

// Company profile (name/sector when adding a ticker)
async function fetchProfile(symbol: string, token?: string) {
  if (!token) return null;
  try {
    const r = await fetch(`${FINNHUB_REST}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${token}`);
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
    const r = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}`, { cache: "no-store" });
    if (!r.ok) return [];
    const j: { data?: Candle[] } = await r.json();
    return Array.isArray(j.data) ? j.data : [];
  } catch {
    return [];
  }
}

/* ========= Page ========= */
export default function StockTracker() {
  const [rows, setRows] = useState(DEFAULT_STOCKS);
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

  // load/save watchlist
  useEffect(() => {
    try {
      const saved = localStorage.getItem("stocksRows");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.every((x) => x && x.ticker)) setRows(parsed);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("stocksRows", JSON.stringify(rows));
    } catch {}
  }, [rows]);

  // load chart when selection/timeframe changes
  useEffect(() => {
    (async () => {
      if (!selected) return;
      const key = `${selected.ticker}_${tf}`;
      setLoading(true);
      setMsg(null);
      try {
        const data = await fetchCandlesRange(selected.ticker, tf);
        if (!data?.length) setMsg("No data for this timeframe (try another range or market hours).");
        setChartCache((p) => ({ ...p, [key]: data || [] }));
      } catch {
        setMsg("Couldn’t load chart data (network).");
      } finally {
        setLoading(false);
      }
    })();
  }, [selected, tf]); // include 'selected' to satisfy ESLint

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

  const selectedKey = selected ? `${selected.ticker}_${tf}` : null;
  const detailData = selectedKey ? chartCache[selectedKey] || [] : [];

  return (
    <div className="p-6 grid gap-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">Top 10 Risk-Tolerant Watchlist</h1>
          <p className="text-sm text-gray-500 mt-1">
            {token
              ? isUSMarketOpenNow()
                ? "Live: quotes via Finnhub (60s) — Market open"
                : "Live: quotes via Finnhub (60s) — Market closed"
              : "Add NEXT_PUBLIC_FINNHUB_KEY in .env.local to enable live quotes"}
          </p>
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <input
            className="border rounded px-3 py-2 w-full sm:w-64"
            placeholder="Filter by ticker, name, sector"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="border rounded px-3 py-2" onClick={() => location.reload()}>
            Refresh
          </button>
        </div>
      </div>

      {/* Add / Reset */}
      <div className="rounded-2xl shadow p-4 grid gap-3 bg-white">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500">Ticker</label>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="e.g., NVDA"
              value={tickerInput}
              onChange={(e) => setTickerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSym()}
            />
          </div>
          <div className="flex-[2]">
            <label className="text-xs text-gray-500">Catalyst (optional)</label>
            <input
              className="border rounded px-3 py-2 w-full"
              placeholder="Why this stock?"
              value={catalystInput}
              onChange={(e) => setCatalystInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSym()}
            />
          </div>
          <div className="flex gap-2">
            <button className="bg-black text-white rounded px-3 py-2" onClick={addSym}>
              Add
            </button>
            <button className="border rounded px-3 py-2" onClick={() => setRows(DEFAULT_STOCKS)}>
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl shadow p-4 bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
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
          <tbody>
            {filtered.map((s) => {
              const q = quotes[s.ticker];
              const up = (q?.change ?? 0) >= 0;
              return (
                <tr key={s.ticker} className="border-t">
                  <td className="p-2 font-semibold">{s.ticker}</td>
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">{fmt(q?.price)}</td>
                  <td className={`p-2 ${up ? "text-green-600" : "text-red-600"}`}>{fmt(q?.change)}</td>
                  <td className={`p-2 ${up ? "text-green-600" : "text-red-600"}`}>{fmt(q?.changePct)}</td>
                  <td className="p-2">{s.sector}</td>
                  <td className="p-2 min-w-[220px]">
                    <input
                      className="border rounded px-2 py-1 w-full"
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
                      className="border rounded px-2 py-1"
                      onClick={() => {
                        setTf("3M");
                        setSelected({ ticker: s.ticker, name: s.name });
                      }}
                    >
                      View
                    </button>
                    <button className="border rounded px-2 py-1" onClick={() => removeSym(s.ticker)}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail chart */}
      {selected && (
        <div className="rounded-2xl shadow p-4 bg-white grid gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-lg font-semibold">
                {selected.ticker} — {rows.find((r) => r.ticker === selected.ticker)?.name || selected.name}
              </div>
              <div className="text-sm text-gray-500">
                {rows.find((r) => r.ticker === selected.ticker)?.sector || ""}
              </div>
            </div>
            <div className="flex gap-2">
              {TIMEFRAMES.map((k) => (
                <button
                  key={k}
                  className={`px-2 py-1 rounded border ${tf === k ? "bg-black text-white" : ""}`}
                  onClick={() => setTf(k)}
                >
                  {k}
                </button>
              ))}
              <button className="px-2 py-1 rounded border" onClick={() => setSelected(null)}>
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
                />
                <YAxis domain={["auto", "auto"]} width={60} />
                <Tooltip
                  formatter={(v: number) => fmt(Number(v))}
                  labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
                />
                <Line type="monotone" dataKey="c" dot={false} strokeWidth={2} stroke="#111" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="text-xs text-gray-500">
            {selected.ticker} {tf} • points: {detailData.length}
          </div>

          {/* Messages */}
          {loading && <div className="text-sm text-gray-500">Loading chart…</div>}
          {!loading && msg && <div className="text-sm text-gray-500">{msg}</div>}
        </div>
      )}

      <div className="text-xs text-gray-500">Your list saves in this browser. Prices may be delayed.</div>
    </div>
  );
}
