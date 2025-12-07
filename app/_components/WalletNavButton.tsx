// app/_components/WalletNavButton.tsx
"use client";

import dynamic from "next/dynamic";

const WalletMultiButtonDynamic = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function WalletNavButton() {
  return (
    <WalletMultiButtonDynamic
      style={{
        borderRadius: 0,
        border: "1px solid rgba(161,161,170,0.7)",
        padding: "0.5rem 1rem",
        fontSize: "10px",
        letterSpacing: "0.24em",
        textTransform: "uppercase",
        background: "transparent",
        color: "#a1a1aa",
      }}
    />
  );
}
