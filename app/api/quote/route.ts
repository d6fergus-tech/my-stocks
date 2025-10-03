import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type QuoteOK = {
  quoteResponse?: {
    result?: Array<{
      symbol?: string;
      regularMarketPrice?: number;
      regularMarketChange?: number;
      regularMarketChangePercent?: number;
    }>;
    error?: unknown;
  };
};

function validSymbol(s: string) {
  return /^[A-Za-z0-9.\-]{1,10}$/.test(s);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  if (!validSymbol(symbol)) {
    return NextResponse.json({ error: "bad symbol" }, { status: 400 });
  }

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
    symbol
  )}`;

  try {
    const r = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; D6-Stock-Tracker/1.0; +https://vercel.app)",
      },
      cache: "no-store",
    });
    if (!r.ok) {
      return NextResponse.json({ error: `upstream ${r.status}` }, { status: 502 });
    }
    const j = (await r.json()) as QuoteOK;
    const q = j.quoteResponse?.result?.[0];
    if (!q || typeof q.regularMarketPrice !== "number") {
      return NextResponse.json(
        { price: null, change: 0, changePct: 0 },
        { status: 200 }
      );
    }
    return NextResponse.json({
      price: q.regularMarketPrice,
      change: q.regularMarketChange ?? 0,
      changePct: q.regularMarketChangePercent ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
