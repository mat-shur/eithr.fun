import { PublicKey } from "@solana/web3.js";

const TREASURY_ID_STR = process.env.NEXT_PUBLIC_TREASURY_ID;

if (!TREASURY_ID_STR) {
  throw new Error("NEXT_PUBLIC_TREASURY_ID is not set");
}

export const TREASURY_ID = new PublicKey(TREASURY_ID_STR);