import { neon } from "@neondatabase/serverless";

export async function POST(req: Request) {
  try {
    const { marketData, marketKey, encryptorKey } = await req.json();

    if (!marketData || !marketKey || !encryptorKey) {
      return new Response("Missing marketData / marketKey / encryptorKey", {
        status: 400,
      });
    }

    const sql = neon(process.env.DATABASE_URL!);

    await sql`
      CREATE TABLE IF NOT EXISTS market_meta (
        market_data_pubkey TEXT PRIMARY KEY,
        market_key_pubkey  TEXT NOT NULL,
        encryptor_key      TEXT NOT NULL,
        created_at         TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    await sql`
      INSERT INTO market_meta (market_data_pubkey, market_key_pubkey, encryptor_key)
      VALUES (${marketData}, ${marketKey}, ${encryptorKey})
      ON CONFLICT (market_data_pubkey)
      DO UPDATE SET
        market_key_pubkey = EXCLUDED.market_key_pubkey,
        encryptor_key     = EXCLUDED.encryptor_key;
    `;

    return Response.json({ ok: true });
  } catch (e: any) {
    console.error("register encryptor error:", e);
    return new Response("Internal error", { status: 500 });
  }
}
