// app/api/markets/[market]/check/route.ts

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
  BN,
  Idl,
  Program,
  Wallet,
} from "@project-serum/anchor";
import { eithrFunIdl } from "../../../../data/idl_type";
import crypto from "crypto";

const PROGRAM_ID = new PublicKey(
  "4dZuWfAH3HeU79Bd1ajUgr4RM2gGJywH2wHQfG8wQeAV"
);

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
  req: NextRequest,
  { params }: { params: Promise<{ market: string }> }
) {
  try {
    const { market } = await params;
    const body = await req.json();
    const raw = body as any;

    const userStr: string | undefined =
      typeof raw.user === "string" ? raw.user : undefined;

    if (!userStr) {
      return NextResponse.json(
        { ok: false, error: "Missing user pubkey in body" },
        { status: 400 }
      );
    }

    const userPk = new PublicKey(userStr);
    const marketDataPk = new PublicKey(market);

    const rpcUrl =
      process.env.SOLANA_RPC_URL || clusterApiUrl("devnet");

    // для читання ончейна можна взяти будь-який keypair
    const dummy = Keypair.generate();
    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new NodeWallet(dummy);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    const program = new Program(eithrFunIdl as Idl, PROGRAM_ID, provider);

    const marketData: any = await program.account.marketData.fetch(
      marketDataPk
    );

    if (!marketData.isFinalized) {
      return NextResponse.json(
        { ok: false, error: "Market is not finalized yet" },
        { status: 400 }
      );
    }

    const winningSide: number = Number(marketData.winningSide);
    if (winningSide !== 0 && winningSide !== 1 && winningSide !== 2) {
      return new NextResponse("Invalid winningSide on-chain", {
        status: 500,
      });
    }

    const totalTicketsSideA = Number(marketData.totalTicketsSideA);
    const totalTicketsSideB = Number(marketData.totalTicketsSideB);
    const totalAmountOnChain = Number(marketData.totalAmount);

    if (totalAmountOnChain <= 0) {
      return NextResponse.json(
        { ok: false, error: "Total pool is zero" },
        { status: 400 }
      );
    }

    const winningTotalTickets =
      winningSide === 1
        ? totalTicketsSideA
        : winningSide === 2
        ? totalTicketsSideB
        : 0;

    // meta з postgres
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

    // UserTickets
    const [userTicketsPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_tickets"),
        marketDataPk.toBuffer(),
        userPk.toBuffer(),
      ],
      PROGRAM_ID
    );

    let userTickets: any;
    try {
      userTickets = await program.account.userTickets.fetch(
        userTicketsPda
      );
    } catch {
      // юзер просто не купував нічого
      return NextResponse.json({
        ok: true,
        hasTickets: false,
        hasClaimed: false,
        canClaim: false,
        isTie: winningSide === 0,
        winningSide,
        claimAmount: "0",
        userWinningTickets: 0,
        winningTotalTickets,
        totalPoolLamports: totalAmountOnChain,
      });
    }

    const hasClaimed = !!userTickets.hasClaimed;
    const userTotalAmount = Number(userTickets.totalAmount);

    // --- нічия: рефанд всього totalAmount ---
    if (winningSide === 0) {
      const claimAmountBN = new BN(userTotalAmount.toString());
      const canClaim =
        !hasClaimed && claimAmountBN.gt(new BN(0));

      return NextResponse.json({
        ok: true,
        hasTickets: userTotalAmount > 0,
        hasClaimed,
        canClaim,
        isTie: true,
        winningSide,
        claimAmount: claimAmountBN.toString(),
        userWinningTickets: 0,
        winningTotalTickets: 0,
        totalPoolLamports: totalAmountOnChain,
      });
    }

    // --- звичайний кейс: рахуємо переможні тікети ---
    let userWinningTickets = 0;
    const choices = userTickets.choices as {
      encodedSideHash: string;
      ticketCount: any;
      creationTime: any;
    }[];

    for (const ch of choices) {
      try {
        const side = decodeSideFromEncoded(
          ch.encodedSideHash,
          encryptor_key,
          market
        );
        const count = Number(ch.ticketCount);
        if (!Number.isFinite(count) || count <= 0) continue;
        if (side === winningSide) {
          userWinningTickets += count;
        }
      } catch (e) {
        console.error("decode error for choice:", e);
        continue;
      }
    }

    if (winningTotalTickets <= 0) {
      return new NextResponse("Winning side has zero tickets", {
        status: 500,
      });
    }

    if (userWinningTickets <= 0) {
      return NextResponse.json({
        ok: true,
        hasTickets: userTotalAmount > 0,
        hasClaimed,
        canClaim: false,
        isTie: false,
        winningSide,
        claimAmount: "0",
        userWinningTickets,
        winningTotalTickets,
        totalPoolLamports: totalAmountOnChain,
      });
    }

    const userWinBN = new BN(userWinningTickets.toString());
    const winTotalBN = new BN(winningTotalTickets.toString());
    const totalPoolBN = new BN(totalAmountOnChain.toString());

    const claimAmountBN = totalPoolBN.mul(userWinBN).div(winTotalBN);
    const canClaim =
      !hasClaimed && claimAmountBN.gt(new BN(0));

    return NextResponse.json({
      ok: true,
      hasTickets: true,
      hasClaimed,
      canClaim,
      isTie: false,
      winningSide,
      claimAmount: claimAmountBN.toString(),
      userWinningTickets,
      winningTotalTickets,
      totalPoolLamports: totalAmountOnChain,
    });
  } catch (e: any) {
    console.error("check win error:", e);
    return new NextResponse(
      e?.message ? String(e.message) : "Internal error",
      { status: 500 }
    );
  }
}
