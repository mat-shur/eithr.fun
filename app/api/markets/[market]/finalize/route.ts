import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  AnchorProvider,
  Idl,
  Program,
  Wallet,
  BN,
} from "@project-serum/anchor";
import { eithrFunIdl } from "../../../../data/idl_type";
import crypto from "crypto";

import { PROGRAM_ID } from "../../../../data/program";

const sql = neon(process.env.DATABASE_URL!);

type MarketMetaRow = {
  encryptor_key: string;
  market_key_pubkey: string;
};

class NodeWallet implements Wallet {
  constructor(readonly payer: Keypair) {}
  async signTransaction(tx: any) {
    tx.sign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    return txs.map((tx) => {
      tx.sign(this.payer);
      return tx;
    });
  }
  get publicKey() {
    return this.payer.publicKey;
  }
}

function keyFromHex(hex: string): Buffer {
  if (hex.length !== 64) {
    throw new Error("Invalid encryptor hex length");
  }
  return Buffer.from(hex, "hex");
}

function decodeSideFromEncoded(
  encoded: string,
  encryptorKeyHex: string,
  expectedMarket: string
): number {
  const key = keyFromHex(encryptorKeyHex);
  const buf = Buffer.from(encoded, "base64");

  if (buf.length < 12 + 16) {
    throw new Error("Encoded payload too short");
  }

  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  const parsed = JSON.parse(plaintext) as {
    side: number;
    secret: string;
    market: string;
    encode_timestamp?: number;
  };

  if (parsed.market !== expectedMarket) {
    throw new Error("Market mismatch in encoded payload");
  }

  if (parsed.side !== 1 && parsed.side !== 2) {
    throw new Error("Invalid side in decoded payload");
  }

  return parsed.side;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  try {
    const { market } = await params;
    const marketDataPk = new PublicKey(market);

    const rpcUrl =
      process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

    const secretStr = process.env.PROJECT_OWNER_SECRET_KEY;
    if (!secretStr) {
      return new NextResponse("Missing PROJECT_OWNER_SECRET_KEY", {
        status: 500,
      });
    }

    let secretKey: Uint8Array;
    try {
      const arr = JSON.parse(secretStr) as number[];
      secretKey = Uint8Array.from(arr);
    } catch {
      return new NextResponse(
        "Invalid PROJECT_OWNER_SECRET_KEY format",
        { status: 500 }
      );
    }

    const ownerKeypair = Keypair.fromSecretKey(secretKey);

    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new NodeWallet(ownerKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new Program(eithrFunIdl as Idl, PROGRAM_ID, provider);

    const marketData: any = await program.account.marketData.fetch(
      marketDataPk
    );

    if (marketData.isFinalized) {
      return NextResponse.json(
        { ok: false, error: "Market already finalized" },
        { status: 409 }
      );
    }

    const creationTime = Number(marketData.creationTime); 
    const duration = Number(marketData.duration); 
    const endTime = creationTime + duration;
    const now = Math.floor(Date.now() / 1000);

    if (now < endTime) {
      return NextResponse.json(
        { ok: false, error: "Market has not ended yet" },
        { status: 400 }
      );
    }

    const totalTicketsOnChain = Number(marketData.totalTickets);
    const totalAmountOnChain = Number(marketData.totalAmount);

    if (totalTicketsOnChain === 0) {
      return NextResponse.json(
        { ok: false, error: "No tickets sold for this market" },
        { status: 400 }
      );
    }

    const ticketPriceLamports = Number(marketData.ticketPrice);

    const rows = (await sql`
      SELECT encryptor_key, market_key_pubkey
      FROM market_meta
      WHERE market_data_pubkey = ${market}
      LIMIT 1
    `) as MarketMetaRow[];

    if (!rows.length) {
      return new NextResponse("Market meta not found in DB", {
        status: 404,
      });
    }

    const { encryptor_key, market_key_pubkey } = rows[0];
    const marketKeyPk = new PublicKey(market_key_pubkey);

    const userTicketsAccounts = await program.account.userTickets.all([
      {
        memcmp: {
          offset: 8,
          bytes: marketDataPk.toBase58(),
        },
      },
    ]);

    let totalTicketsSideA = 0;
    let totalTicketsSideB = 0;

    for (const { account } of userTicketsAccounts) {
      const choices = account.choices as {
        encodedSideHash: string;
        ticketCount: any;
        creationTime: any;
      }[];

      for (const ch of choices) {
        const side = decodeSideFromEncoded(
          ch.encodedSideHash,
          encryptor_key,
          market
        );

        const count = Number(ch.ticketCount);

        if (!Number.isFinite(count) || count <= 0) continue;

        if (side === 1) {
          totalTicketsSideA += count;
        } else {
          totalTicketsSideB += count;
        }
      }
    }

    const sumTickets = totalTicketsSideA + totalTicketsSideB;
    if (sumTickets !== totalTicketsOnChain) {
      return new NextResponse("Ticket totals mismatch", {
        status: 500,
      });
    }

    const totalAmountSideA = totalTicketsSideA * ticketPriceLamports;
    const totalAmountSideB = totalTicketsSideB * ticketPriceLamports;
    const sumAmount = totalAmountSideA + totalAmountSideB;

    if (sumAmount !== totalAmountOnChain) {
      return new NextResponse("Amount totals mismatch", {
        status: 500,
      });
    }

    let winningSide: 0 | 1 | 2;

    if (totalTicketsSideA === totalTicketsSideB) {
        winningSide = 0;
    } else {
        winningSide = totalTicketsSideA > totalTicketsSideB ? 1 : 2;
    }

    const ttA = new BN(totalTicketsSideA.toString());
    const ttB = new BN(totalTicketsSideB.toString());
    const taA = new BN(totalAmountSideA.toString());
    const taB = new BN(totalAmountSideB.toString());

    const txSig = await program.methods
      .finalizeMarket(ttA, ttB, taA, taB, winningSide, encryptor_key)
      .accounts({
        authority: ownerKeypair.publicKey,
        marketKey: marketKeyPk,
        marketData: marketDataPk,
      })
      .signers([ownerKeypair])
      .rpc();

    return NextResponse.json({
    ok: true,
    tx: txSig,
    winningSide,
    isTie: winningSide === 0,
    totals: {
        totalTicketsSideA,
        totalTicketsSideB,
        totalAmountSideA,
        totalAmountSideB,
    },
    });
  } catch (e: any) {
    console.error("finalize error:", e);
    return new NextResponse(
      e?.message ? String(e.message) : "Internal error",
      {
        status: 500,
      }
    );
  }
}
