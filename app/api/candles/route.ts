// app/api/candles/route.ts
import { NextResponse } from "next/server";

const MAP: Record<string, { range: string; interval: string }> = {
  "1D": { range: "1d",  interval: "5m"  },
  "5D": { range: "5d",  interval: "15m" },
  "1M": { range: "1mo", interval: "1d"  },
  "3M": { range: "3mo", interval: "1d"  },
  "6M": { range: "6mo", interval: "1d"  },
  "1Y": { range: "1y",  interval: "1d"  },
  "5Y": { range: "5y",  interval: "1wk" },
};

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").toUpperCase();
    const tf = (searchParams.get("tf") || "3M").toUpperCase();
    if (!symbol) {
      return NextResponse.json({ data: [], error: "missing symbol" }, { status: 400 });
    }

    const m = MAP[tf] ?? MAP["3M"];
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?range=${m.range}&interval=${m.interval}`;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json({ data: [], error: `yahoo ${r.status}` });
    }

    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    const ts: number[] = res?.timestamp || [];
    const close: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];

    const out: { t: number; c: number }[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = close[i];
      if (typeof c === "number" && !Number.isNaN(c)) out.push({ t: ts[i] * 1000, c });
    }

    return NextResponse.json({ data: out });
  } catch {
    return NextResponse.json({ data: [], error: "server error" });
  }
}
