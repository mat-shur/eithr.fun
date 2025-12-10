import { PublicKey } from "@solana/web3.js";

const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_PROGRAM_ID;

if (!PROGRAM_ID_STR) {
  throw new Error("NEXT_PUBLIC_PROGRAM_ID is not set");
}

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);