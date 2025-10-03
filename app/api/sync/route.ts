import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

type Row = { ticker: string; name: string; sector: string; catalyst: string };

const hasEnv =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) &&
  Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const redis = hasEnv ? Redis.fromEnv() : null;

function validId(id: string): boolean {
  return /^[A-Za-z0-9_-]{6,64}$/.test(id);
}

export async function GET(req: Request) {
  if (!hasEnv) {
    return NextResponse.json({ error: "KV not configured" }, { status: 501 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  try {
    const key = `watchlist:${id}`;
    const rows = (await redis!.get<Row[]>(key)) ?? [];
    const updatedAt = (await redis!.get<number>(`${key}:ts`)) ?? 0;
    return NextResponse.json({ rows, updatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!hasEnv) {
    return NextResponse.json({ error: "KV not configured" }, { status: 501 });
  }
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const rows = (body as { rows?: unknown } | null)?.rows;

  const okShape =
    Array.isArray(rows) &&
    rows.every((v: unknown): v is Row => {
      if (!v || typeof v !== "object") return false;
      const o = v as Record<string, unknown>;
      return (
        typeof o.ticker === "string" &&
        typeof o.name === "string" &&
        typeof o.sector === "string" &&
        typeof o.catalyst === "string"
      );
    });

  if (!okShape) return NextResponse.json({ error: "invalid rows" }, { status: 400 });

  try {
    const key = `watchlist:${id}`;
    await redis!.set(key, rows);
    await redis!.set(`${key}:ts`, Date.now());
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
