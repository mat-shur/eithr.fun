// app/api/markets/[market]/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import crypto from "crypto";

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { AnchorProvider, Program, Idl } from "@project-serum/anchor";

import { eithrFunIdl } from "../../../../data/idl_type";
import { PROGRAM_ID } from "../../../../data/program";

const sql = neon(process.env.DATABASE_URL!);

const LAMPORTS_PER_SOL = 1_000_000_000;
const TREASURY_FEE_BPS = 500; // 5%

type MarketMetaRow = {
  market_data_pubkey: string;
  market_key_pubkey: string;
  encryptor_key: string;
};

export type MarketStatsRow = {
  wallet: string;
  ticketsA: number;
  ticketsB: number;
  amountSol: number;
  pnlSol: number;
  outcome: "WIN" | "LOSE" | "TIE" | "NEUTRAL";
  hasClaimed: boolean;
};

export type MarketStatsResponse = {
  rows: MarketStatsRow[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
};

type DecodedPayload = {
  side: number; // 1 | 2
  secret?: string;
  market: string;
  encode_timestamp?: number;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  try {
    const { market } = await params;

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
      100,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? "20"))
    );

    const metaRows = (await sql`
      SELECT market_data_pubkey, market_key_pubkey, encryptor_key
      FROM market_meta
      WHERE market_data_pubkey = ${market}
         OR market_key_pubkey   = ${market}
      LIMIT 1
    `) as MarketMetaRow[];

    if (!metaRows || metaRows.length === 0) {
      return NextResponse.json(
        { error: "Market meta not found" },
        { status: 404 }
      );
    }

    const { market_data_pubkey, market_key_pubkey, encryptor_key } =
      metaRows[0];
    const marketDataPk = new PublicKey(market_data_pubkey);

    const rpcUrl =
      process.env.SOLANA_RPC_URL ?? process.env.NEXT_PUBLIC_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json(
        { error: "SOLANA_RPC_URL is not configured" },
        { status: 500 }
      );
    }

    const connection = new Connection(rpcUrl, "confirmed");

    const dummyWallet = {
      publicKey: Keypair.generate().publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };

    const provider = new AnchorProvider(connection, dummyWallet as any, {
      commitment: "confirmed",
    });
    const program = new Program(eithrFunIdl as Idl, PROGRAM_ID, provider);

    const marketData: any = await program.account.marketData.fetch(
      marketDataPk
    );

    if (!marketData.isFinalized) {
      return NextResponse.json(
        { error: "Market not finalized yet" },
        { status: 400 }
      );
    }

    const ticketPriceLamports = BigInt(marketData.ticketPrice.toString());
    const winningSide: number = Number(marketData.winningSide);

    const totalPoolLamports = BigInt(marketData.totalAmount.toString());
    const totalAmountSideALamports = BigInt(
      marketData.totalAmountSideA.toString()
    );
    const totalAmountSideBLamports = BigInt(
      marketData.totalAmountSideB.toString()
    );

    const keyBuf = Buffer.from(encryptor_key, "hex");
    if (keyBuf.length !== 32) {
      console.error(
        "stats: invalid encryptor_key length, expected 32 bytes, got",
        keyBuf.length
      );
      return NextResponse.json(
        { error: "Invalid encryptor key in DB" },
        { status: 500 }
      );
    }

    function decodeChoice(encoded: string): DecodedPayload | null {
      try {
        const buf = Buffer.from(encoded, "base64");
        if (buf.length < 12 + 16) return null;

        const iv = buf.subarray(0, 12);
        const authTag = buf.subarray(12, 28);
        const ciphertext = buf.subarray(28);

        const decipher = crypto.createDecipheriv(
          "aes-256-gcm",
          keyBuf,
          iv
        );
        decipher.setAuthTag(authTag);

        const plaintext = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString("utf8");

        const payload = JSON.parse(plaintext) as DecodedPayload;

        if (!payload || (payload.side !== 1 && payload.side !== 2)) {
          return null;
        }

        const m = payload.market;
        if (
          m !== market &&
          m !== market_data_pubkey &&
          m !== market_key_pubkey
        ) {
          return null;
        }

        return payload;
      } catch (e) {
        console.warn("decodeChoice failed:", e);
        return null;
      }
    }

    const userTicketAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        {
          memcmp: {
            offset: 8,
            bytes: marketDataPk.toBase58(),
          },
        },
      ],
    });

    type AggRow = {
      wallet: string;
      ticketsA: bigint;
      ticketsB: bigint;
      totalAmountLamports: bigint;
      hasClaimed: boolean;
    };

    const aggregated: AggRow[] = [];
    const ZERO = BigInt(0);
    const TEN_THOUSAND = BigInt(10000);

    for (const acc of userTicketAccounts) {
      let ut: any;
      try {
        ut = await program.account.userTickets.fetch(acc.pubkey);
      } catch (e) {
        console.warn(
          "failed to fetch userTickets for",
          acc.pubkey.toBase58(),
          e
        );
        continue;
      }

      const userPk: PublicKey = ut.user;
      const wallet = userPk.toBase58();

      const totalAmountLamports = BigInt(ut.totalAmount.toString());
      const choices: any[] = ut.choices ?? [];
      const hasClaimed: boolean = !!ut.hasClaimed;

      let ticketsA = ZERO;
      let ticketsB = ZERO;

      for (const choice of choices) {
        const encodedHash: string = choice.encodedSideHash;
        const decoded = decodeChoice(encodedHash);
        if (!decoded) continue;

        const count = BigInt(choice.ticketCount.toString());
        if (decoded.side === 1) ticketsA += count;
        if (decoded.side === 2) ticketsB += count;
      }

      aggregated.push({
        wallet,
        ticketsA,
        ticketsB,
        totalAmountLamports,
        hasClaimed,
      });
    }

    const rows: MarketStatsRow[] = aggregated.map((row) => {
      const { wallet, ticketsA, ticketsB, totalAmountLamports, hasClaimed } =
        row;

      const amountA = ticketsA * ticketPriceLamports;
      const amountB = ticketsB * ticketPriceLamports;

      let pnlLamports = ZERO;

      if (winningSide === 0) {
        pnlLamports = ZERO;
      } else {
        const userStake = winningSide === 1 ? amountA : amountB;

        if (userStake === ZERO) {
          pnlLamports = -totalAmountLamports;
        } else {
          const totalWinnerStake =
            winningSide === 1
              ? totalAmountSideALamports
              : totalAmountSideBLamports;

          if (totalWinnerStake === ZERO) {
            pnlLamports = -totalAmountLamports;
          } else {
            const gross =
              (userStake * totalPoolLamports) / totalWinnerStake;

            const fee =
              (gross * BigInt(TREASURY_FEE_BPS)) / TEN_THOUSAND;
            const net = gross - fee;

            pnlLamports = net - totalAmountLamports;
          }
        }
      }

      const amountSol =
        Number(totalAmountLamports) / LAMPORTS_PER_SOL;
      const pnlSol = Number(pnlLamports) / LAMPORTS_PER_SOL;

      let outcome: "WIN" | "LOSE" | "TIE" | "NEUTRAL" = "NEUTRAL";
      if (winningSide === 0) {
        outcome = "TIE";
      } else if (pnlLamports > ZERO) {
        outcome = "WIN";
      } else if (pnlLamports < ZERO) {
        outcome = "LOSE";
      } else {
        outcome = "NEUTRAL";
      }

      return {
        wallet,
        ticketsA: Number(ticketsA),
        ticketsB: Number(ticketsB),
        amountSol,
        pnlSol,
        outcome,
        hasClaimed,
      };
    });

    rows.sort((a, b) => {
      const ord = (o: MarketStatsRow["outcome"]) =>
        o === "WIN"
          ? 0
          : o === "TIE"
          ? 1
          : o === "NEUTRAL"
          ? 2
          : 3;

      const oa = ord(a.outcome);
      const ob = ord(b.outcome);
      if (oa !== ob) return oa - ob;

      if (b.pnlSol !== a.pnlSol) return b.pnlSol - a.pnlSol;
      return a.wallet.localeCompare(b.wallet);
    });

    const totalRows = rows.length;
    const totalPages =
      totalRows === 0 ? 1 : Math.ceil(totalRows / pageSize);
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * pageSize;
    const pagedRows = rows.slice(start, start + pageSize);

    const response: MarketStatsResponse = {
      rows: pagedRows,
      page: safePage,
      pageSize,
      totalPages,
      totalRows,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("stats error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
