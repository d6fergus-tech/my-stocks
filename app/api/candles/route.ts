// app/api/candles/route.ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type TF = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "5Y";
type Candle = { t: number; c: number };

const MAP: Record<TF, { range: string; interval: string }> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
};

type YahooQuoteBlock = { close?: Array<number | null> };
type YahooResult = {
  timestamp?: number[];
  indicators?: { quote?: YahooQuoteBlock[] };
};
type YahooChartResponse = {
  chart?: { result?: YahooResult[] };
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  const tfParam = ((searchParams.get("tf") || "3M").toUpperCase() as TF) || "3M";
  const tf: TF = MAP[tfParam] ? tfParam : "3M";

  if (!symbol) {
    return NextResponse.json({ data: [] as Candle[], error: "missing symbol" }, { status: 400 });
  }

  const { range, interval } = MAP[tf];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=${range}&interval=${interval}`;

  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ data: [] as Candle[], error: `yahoo ${r.status}` });
    }

    const j: YahooChartResponse = await r.json();
    const res = j.chart?.result?.[0];

    const ts = Array.isArray(res?.timestamp) ? (res!.timestamp as number[]) : [];
    const quoteBlock = res?.indicators?.quote?.[0];
    const closes = Array.isArray(quoteBlock?.close) ? (quoteBlock!.close as Array<number | null>) : [];

    const out: Candle[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) out.push({ t: ts[i] * 1000, c });
    }

    return NextResponse.json({ data: out });
  } catch {
    return NextResponse.json({ data: [] as Candle[], error: "server error" });
  }
}
