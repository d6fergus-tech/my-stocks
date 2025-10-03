// app/api/quote/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type ChartResult = {
  meta?: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
  };
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};
type ChartResp = {
  chart?: {
    result?: ChartResult[];
    error?: { code?: string; description?: string } | null;
  };
};

function validSymbol(s: string) {
  return /^[A-Za-z0-9.\-]{1,10}$/.test(s);
}

function lastNonNull(arr: Array<number | null | undefined>): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function buildUrl(symbol: string, range: string, interval: string) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}&includePrePost=true`;
}

async function fetchChart(url: string): Promise<ChartResp | null> {
  try {
    const r = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; D6-Stock-Tracker/1.0; +https://vercel.app)",
        accept: "application/json,text/javascript,*/*;q=0.1",
      },
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as ChartResp;
  } catch {
    return null;
  }
}

function computeQuote(res: ChartResult | undefined) {
  if (!res) return { price: null as number | null, change: 0, changePct: 0 };

  const meta = res.meta ?? {};
  const closes = res.indicators?.quote?.[0]?.close ?? [];
  let price =
    typeof meta.regularMarketPrice === "number"
      ? meta.regularMarketPrice
      : lastNonNull(closes);

  const prev =
    typeof meta.chartPreviousClose === "number"
      ? meta.chartPreviousClose
      : typeof meta.previousClose === "number"
      ? meta.previousClose
      : null;

  if (price == null || !Number.isFinite(price)) {
    return { price: null as number | null, change: 0, changePct: 0 };
  }
  const change = prev != null ? price - prev : 0;
  const changePct = prev && prev !== 0 ? (change / prev) * 100 : 0;

  return { price, change, changePct };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!validSymbol(symbol)) {
    return NextResponse.json({ error: "bad symbol" }, { status: 400 });
  }

  // Try intraday first, then fall back to daily if needed
  const urls = [
    buildUrl(symbol, "1d", "1m"),
    buildUrl(symbol, "5d", "1d"),
  ];

  for (const url of urls) {
    const data = await fetchChart(url);
    const res = data?.chart?.result?.[0];
    if (res) {
      const q = computeQuote(res);
      return NextResponse.json(q);
    }
  }

  // If both attempts failed (network/401/etc.), report gracefully
  return NextResponse.json(
    { price: null, change: 0, changePct: 0 },
    { status: 200 }
  );
}
