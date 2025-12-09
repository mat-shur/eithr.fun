
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

type MarketMetaRow = {
  market_data_pubkey: string;
  market_key_pubkey: string;
  encryptor_key: string; 
};

const sql = neon(process.env.DATABASE_URL!);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  try {
    const { market } = await params;
    const body = await req.json();
    const raw = body as any;

    let sideNumeric: 1 | 2 | null = null;

    if (raw.side === "A" || raw.side === "a") {
      sideNumeric = 1;
    } else if (raw.side === "B" || raw.side === "b") {
      sideNumeric = 2;
    } else if (raw.side === 1 || raw.side === 2) {
      sideNumeric = raw.side;
    }

    const secret: string | undefined =
      typeof raw.secret === "string" ? raw.secret : undefined;

    if (!sideNumeric || !secret) {
      return NextResponse.json(
        { error: "Missing or invalid side / secret" },
        { status: 400 }
      );
    }

    const rows = (await sql`
      SELECT market_data_pubkey, market_key_pubkey, encryptor_key
      FROM market_meta
      WHERE market_data_pubkey = ${market}
         OR market_key_pubkey   = ${market}
      LIMIT 1
    `) as MarketMetaRow[];

    if (!rows || rows.length === 0) {
      console.error("encode: market_meta not found for market:", market);
      return NextResponse.json(
        { error: "Market meta not found" },
        { status: 404 }
      );
    }

    const { encryptor_key, market_key_pubkey } = rows[0];

    const keyBuf = Buffer.from(encryptor_key, "hex");
    if (keyBuf.length !== 32) {
      console.error(
        "encode: invalid encryptor_key length, expected 32 bytes, got",
        keyBuf.length
      );
      return NextResponse.json(
        { error: "Invalid encryptor key in DB" },
        { status: 500 }
      );
    }

    const iv = crypto.randomBytes(12);

    const encodeTimestamp = Math.floor(Date.now() / 1000); 
    const payloadObj = {
      side: sideNumeric,          
      secret,                
      market,                 
      encode_timestamp: encodeTimestamp,
    };

    const plaintext = Buffer.from(JSON.stringify(payloadObj), "utf8");

    const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, authTag, ciphertext]);
    const encodedSideHash = combined.toString("base64");

    return NextResponse.json({
      encodedSideHash,
      marketKey: market_key_pubkey,
      encodeTimestamp,
    });
  } catch (err) {
    console.error("encode error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
