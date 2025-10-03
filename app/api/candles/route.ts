import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ChartOK = {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
    error?: { code: string; description: string } | null;
  };
};

function validSymbol(s: string) {
  return /^[A-Za-z0-9.\-]{1,10}$/.test(s);
}
const ALLOWED_RANGE = new Set(["5d", "1mo", "3mo", "1y", "5y"]);
const ALLOWED_INTERVAL = new Set(["15m", "1d", "1wk"]);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  const range = searchParams.get("range") || "3mo";
  const interval = searchParams.get("interval") || "1d";

  if (!validSymbol(symbol)) {
    return NextResponse.json({ error: "bad symbol" }, { status: 400 });
  }
  if (!ALLOWED_RANGE.has(range) || !ALLOWED_INTERVAL.has(interval)) {
    return NextResponse.json({ error: "bad params" }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=true`;

  try {
    const r = await fetch(url, {
      headers: {
        // Some environments are picky; a UA tends to help.
        "user-agent":
          "Mozilla/5.0 (compatible; D6-Stock-Tracker/1.0; +https://vercel.app)",
      },
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    }
    const j = (await r.json()) as ChartOK;
    const res = j.chart?.result?.[0];
    if (!res?.timestamp || !res.indicators?.quote?.[0]?.close) {
      return NextResponse.json({ points: [] }, { status: 200 });
    }
    const ts = res.timestamp;
    const cl = res.indicators.quote[0].close;

    const points = [] as { t: number; c: number }[];
    for (let i = 0; i < ts.length && i < cl.length; i++) {
      const t = ts[i];
      const c = cl[i];
      if (typeof t === "number" && typeof c === "number") {
        // Yahoo timestamps are in seconds; convert to ms for charts.
        points.push({ t: t * 1000, c });
      }
    }
    return NextResponse.json({ points });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
