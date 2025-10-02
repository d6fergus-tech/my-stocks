import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const dynamic = "force-dynamic";

type Row = { ticker: string; name: string; sector: string; catalyst: string };

function ready() {
  return !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
}
function validId(id: string) {
  return /^[a-zA-Z0-9_-]{6,64}$/.test(id);
}

const redis = ready() ? Redis.fromEnv() : null;

function safeErr(e: unknown): string {
  // Don’t leak secrets; just return a short message
  if (e && typeof e === "object" && "message" in e) {
    const msg = String((e as any).message || "");
    // scrub anything that looks like a token or URL
    return msg.replace(/[A-Za-z0-9_-]{20,}/g, "***");
  }
  return "Unknown error";
}

export async function GET(req: Request) {
  if (!ready()) return NextResponse.json({ error: "KV not configured" }, { status: 501 });
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

    const key = `watchlist:${id}`;
    const [rows, updatedAt] = await Promise.all([
      redis!.get<Row[]>(key),
      redis!.get<number>(`${key}:ts`),
    ]);
    return NextResponse.json({ rows: rows ?? [], updatedAt: updatedAt ?? 0 });
  } catch (e) {
    console.error("SYNC GET error:", e);
    return NextResponse.json({ error: safeErr(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!ready()) return NextResponse.json({ error: "KV not configured" }, { status: 501 });
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id") || "";
    if (!validId(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

    const body = (await req.json().catch(() => null)) as { rows?: unknown };
    const rows = body?.rows;
    const okShape = Array.isArray(rows) && rows.every((v) => v && typeof v === "object" && "ticker" in v);
    if (!okShape) return NextResponse.json({ error: "invalid rows" }, { status: 400 });

    const key = `watchlist:${id}`;
    await Promise.all([redis!.set(key, rows), redis!.set(`${key}:ts`, Date.now())]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("SYNC PUT error:", e);
    return NextResponse.json({ error: safeErr(e) }, { status: 500 });
  }
}
