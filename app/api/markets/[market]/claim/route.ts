import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
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

import { PROGRAM_ID } from "../../../../data/program";
import { TREASURY_ID as PROJECT_TREASURY } from "../../../../data/treasury";

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

// AES-256-GCM decode: base64( iv[12] | authTag[16] | ciphertext )
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
      winningSide === 1 ? totalTicketsSideA : totalTicketsSideB;

    if (winningTotalTickets <= 0) {
      return new NextResponse("Winning side has zero tickets", {
        status: 500,
      });
    }

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
      return NextResponse.json(
        { ok: false, error: "UserTickets account not found" },
        { status: 404 }
      );
    }

    if (userTickets.hasClaimed) {
      return NextResponse.json(
        { ok: false, error: "User already claimed" },
        { status: 409 }
      );
    }

    if (winningSide === 0) {
        const userTotalAmount = new BN(userTickets.totalAmount.toString());
    
        if (userTotalAmount.lte(new BN(0))) {
        return NextResponse.json(
            { ok: false, error: "User has no funds to refund" },
            { status: 400 }
        );
        }
    
        const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury_account"), marketKeyPk.toBuffer()],
        PROGRAM_ID
        );
    
        const claimAmountBN = userTotalAmount;
    
        const tx = await program.methods
        .claimReward(claimAmountBN)
        .accounts({
            authority: ownerKeypair.publicKey,
            user: userPk,
            marketKey: marketKeyPk,
            marketData: marketDataPk,
            treasuryAccount: treasuryPda,
            userTickets: userTicketsPda,
            projectTreasury: PROJECT_TREASURY,
            systemProgram: SystemProgram.programId,
        })
        .transaction();
    
        const { blockhash } = await connection.getLatestBlockhash();
        tx.feePayer = userPk;
        tx.recentBlockhash = blockhash;
        tx.sign(ownerKeypair);
    
        const serialized = tx.serialize({
        requireAllSignatures: false,
        });
    
        return NextResponse.json({
            ok: true,
            tx: serialized.toString("base64"),
            claimAmount: claimAmountBN.toString(),
            winningSide, 
            isTie: true,
            userWinningTickets: 0,
            winningTotalTickets: 0,
            totalPoolLamports: totalAmountOnChain,
        });
    }

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

    if (userWinningTickets <= 0) {
      return NextResponse.json(
        { ok: false, error: "User has no winning tickets" },
        { status: 400 }
      );
    }

    const userWinBN = new BN(userWinningTickets.toString());
    const winTotalBN = new BN(winningTotalTickets.toString());
    const totalPoolBN = new BN(totalAmountOnChain.toString());

    const claimAmountBN = totalPoolBN.mul(userWinBN).div(winTotalBN);
    const claimAmount = claimAmountBN.toNumber();

    if (claimAmount <= 0) {
      return NextResponse.json(
        { ok: false, error: "Claim amount is zero" },
        { status: 400 }
      );
    }

    const [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury_account"), marketKeyPk.toBuffer()],
      PROGRAM_ID
    );

    const tx = await program.methods
      .claimReward(claimAmountBN)
      .accounts({
        authority: ownerKeypair.publicKey,
        user: userPk,
        marketKey: marketKeyPk,
        marketData: marketDataPk,
        treasuryAccount: treasuryPda,
        userTickets: userTicketsPda,
        projectTreasury: PROJECT_TREASURY,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    const { blockhash } = await connection.getLatestBlockhash();
    tx.feePayer = userPk;
    tx.recentBlockhash = blockhash;

    tx.sign(ownerKeypair);

    const serialized = tx.serialize({
      requireAllSignatures: false,
    });

    return NextResponse.json({
      ok: true,
      tx: serialized.toString("base64"),
      claimAmount: claimAmountBN.toString(),
      winningSide,
      userWinningTickets,
      winningTotalTickets,
      totalPoolLamports: totalAmountOnChain,
    });
  } catch (e: any) {
    console.error("claim error:", e);
    return new NextResponse(
      e?.message ? String(e.message) : "Internal error",
      { status: 500 }
    );
  }
}
