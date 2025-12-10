"use client";

import { useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { AnchorProvider, BN, Idl, Program } from "@project-serum/anchor";
import { eithrFunIdl } from "../../data/idl_type";

const PROGRAM_ID = new PublicKey(
  "4dZuWfAH3HeU79Bd1ajUgr4RM2gGJywH2wHQfG8wQeAV"
);
const LAMPORTS_PER_SOL = 1_000_000_000;

type MarketPhase = "OPEN" | "AWAIT_FINALIZE" | "FINALIZED";

type MarketClientProps = {
  slug: string; 
};

type UiMarketState = {
    title: string;
    description: string;
    sideA: string;
    sideB: string;
  
    ticketPriceSol: number;
    poolSol: number;      
    treasurySol: number;  
  
    endTs: number;      
    isFinalized: boolean;
    winningSide: 0 | 1 | 2;
  
    totalTickets: number;
    totalTicketsSideA: number;
    totalTicketsSideB: number;
  
    sideAPercent: number;
    sideBPercent: number;
  };

type SideColors = {
  a: string;
  b: string;
};

type ClaimPreview = {
    checkedAt: string;
    canClaim: boolean;
    hasClaimed: boolean;
    isTie: boolean;
    winningSide: 0 | 1 | 2;
    claimAmountLamports: number;
    claimSol: number;
    userWinningTickets: number;
    winningTotalTickets: number;
  };
  
function hashStringToInt(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

const COLOR_PALETTES: SideColors[] = [
  {
    a: "from-rose-400 to-rose-600",
    b: "from-sky-400 to-sky-600",
  },
  {
    a: "from-emerald-300 to-emerald-600",
    b: "from-amber-300 to-amber-600",
  },
  {
    a: "from-fuchsia-400 to-fuchsia-700",
    b: "from-cyan-300 to-cyan-600",
  },
  {
    a: "from-indigo-400 to-indigo-700",
    b: "from-orange-300 to-orange-600",
  },
  {
    a: "from-lime-300 to-lime-600",
    b: "from-pink-300 to-pink-600",
  },
];

function pickSideColors(seed: string): SideColors {
  const h = hashStringToInt(seed);
  const idx = h % COLOR_PALETTES.length;
  return COLOR_PALETTES[idx];
}

function formatTimeLeft(endTs: number, nowTs: number): string {
  if (nowTs >= endTs) return "Ended";

  const diff = endTs - nowTs;
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return "<1m";
}

type LocalTicketEntry = {
  side: "A" | "B";
  count: number;
  createdAt: string;
  txSig?: string;
  encodedHash?: string; 
};

const LOCAL_TICKETS_PREFIX = "eithr_fun_tickets_v1";

const makeLocalStorageKey = (marketSlug: string, userPubkey: string) =>
  `${LOCAL_TICKETS_PREFIX}:${marketSlug}:${userPubkey}`;

export default function MarketClient({ slug }: MarketClientProps) {
  const [uiMarket, setUiMarket] = useState<UiMarketState | null>(null);
  const [sideColors, setSideColors] = useState<SideColors>(pickSideColors(slug));
  const [selectedSide, setSelectedSide] = useState<"a" | "b">("a");
  const [tickets, setTickets] = useState<number>(10);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [buyLoading, setBuyLoading] = useState(false);
  const [buyMessage, setBuyMessage] = useState<string | null>(null);

  const [finalizeLoading, setFinalizeLoading] = useState(false);

  const [claimLoading, setClaimLoading] = useState(false);
  const [claimMessage, setClaimMessage] = useState<string | null>(null);

  const [claimPreview, setClaimPreview] = useState<ClaimPreview | null>(null);
  const [checkingWin, setCheckingWin] = useState(false);

  const { connection } = useConnection();
  const wallet = useWallet();

  const [myTickets, setMyTickets] = useState<LocalTicketEntry[]>([]);

  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

    useEffect(() => {
    const id = setInterval(() => {
        setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => clearInterval(id);
    }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!wallet.publicKey) {
      setMyTickets([]);
      return;
    }

    const key = makeLocalStorageKey(slug, wallet.publicKey.toBase58());

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setMyTickets([]);
      } else {
        const parsed = JSON.parse(raw) as LocalTicketEntry[];
        setMyTickets(Array.isArray(parsed) ? parsed : []);
      }
    } catch (e) {
      console.warn("failed to load local tickets", e);
      setMyTickets([]);
    }
  }, [slug, wallet.publicKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!wallet.publicKey) return;

    const key = makeLocalStorageKey(slug, wallet.publicKey.toBase58());
    try {
      window.localStorage.setItem(key, JSON.stringify(myTickets));
    } catch (e) {
      console.warn("failed to save local tickets", e);
    }
  }, [slug, wallet.publicKey, myTickets]);

  const totalTickets = myTickets.reduce((sum, t) => sum + t.count, 0);
  const totalTicketsA = myTickets
    .filter((t) => t.side === "A")
    .reduce((sum, t) => sum + t.count, 0);
  const totalTicketsB = myTickets
    .filter((t) => t.side === "B")
    .reduce((sum, t) => sum + t.count, 0);

  const provider = useMemo(() => {
    return new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });
  }, [connection, wallet]);

  const program = useMemo(
    () => new Program(eithrFunIdl as Idl, PROGRAM_ID, provider),
    [provider]
  );

  const effectiveTickets = Number.isFinite(tickets) ? tickets : 0;
  const estimatedCost =
    (uiMarket?.ticketPriceSol ?? 0) * (effectiveTickets || 0);

  // ---- BUY ----
  const handleBuy = async () => {
    if (!uiMarket) return;
    if (!wallet.connected || !wallet.publicKey) {
      setBuyMessage("Connect wallet first.");
      return;
    }

    if (!Number.isFinite(effectiveTickets) || effectiveTickets <= 0) {
      setBuyMessage("Tickets must be a positive number.");
      return;
    }

    try {
      setBuyLoading(true);
      setBuyMessage(null);

      const marketDataPk = new PublicKey(slug);

      const res = await fetch(`/api/markets/${slug}/encode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side: selectedSide === "a" ? "A" : "B",
          secret: wallet.publicKey.toBase58(),
        }),
      });

      if (!res.ok) {
        let msg = "Encode API error";
        try {
          const data = await res.json();
          if (data?.error) msg = `Encode API error: ${data.error}`;
        } catch {
          const text = await res.text();
          msg = `Encode API error: ${text}`;
        }
        throw new Error(msg);
      }

      const { encodedSideHash, marketKey } = await res.json();

      const marketKeyPk = new PublicKey(marketKey);

      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury_account"), marketKeyPk.toBuffer()],
        PROGRAM_ID
      );

      const [userTicketsPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_tickets"),
          marketDataPk.toBuffer(),
          wallet.publicKey.toBuffer(),
        ],
        PROGRAM_ID
      );

      const sig = await program.methods
        .buyTickets(encodedSideHash, new BN(effectiveTickets))
        .accounts({
          payer: wallet.publicKey,
          marketKey: marketKeyPk,
          marketData: marketDataPk,
          treasuryAccount: treasuryPda,
          userTickets: userTicketsPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("buyTickets tx:", sig);
      setBuyMessage("Tickets purchased successfully.");

      const entry: LocalTicketEntry = {
        side: selectedSide === "a" ? "A" : "B",
        count: effectiveTickets,
        createdAt: new Date().toISOString(),
        txSig: sig,
        encodedHash: encodedSideHash,
      };

      setMyTickets((prev) => [...prev, entry]);

      setTimeout(() => {
        (async () => {
          try {
            const account: any = await program.account.marketData.fetch(
              marketDataPk
            );
            const totalAmountLamports = (
              account.totalAmount as BN
            ).toNumber();
            const poolSol = totalAmountLamports / LAMPORTS_PER_SOL;

            setUiMarket((prev) =>
              prev
                ? {
                    ...prev,
                    poolSol,
                  }
                : prev
            );
          } catch (e) {
            console.error("reload after buy error:", e);
          }
        })();
      }, 5000);
    } catch (e: any) {
      console.error("buy error:", e);
      setBuyMessage(e?.message ?? "Failed to buy tickets.");
    } finally {
      setBuyLoading(false);
    }
  };

  const runCheckWin = async () => {
    if (!wallet.publicKey) {
      setClaimMessage("Connect wallet first.");
      return;
    }
  
    try {
      setCheckingWin(true);
      setClaimMessage(null);
  
      const res = await fetch(`/api/markets/${slug}/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: wallet.publicKey.toBase58() }),
      });
  
      const json = await res.json().catch(() => null);
  
      if (!res.ok || !json?.ok) {
        const errMsg =
          json?.error || json?.message || `Check API error`;
        setClaimMessage(`Check failed: ${errMsg}`);
        setClaimPreview(null);
        return;
      }
  
      const lamports = Number(json.claimAmount ?? 0);
      const claimSol =
        Number.isFinite(lamports) && lamports > 0
          ? lamports / LAMPORTS_PER_SOL
          : 0;
  
      setClaimPreview({
        checkedAt: new Date().toISOString(),
        canClaim: json.canClaim,
        hasClaimed: json.hasClaimed,
        isTie: json.isTie ?? false,
        winningSide: json.winningSide as 0 | 1 | 2,
        claimAmountLamports: lamports,
        claimSol,
        userWinningTickets: json.userWinningTickets ?? 0,
        winningTotalTickets: json.winningTotalTickets ?? 0,
      });
  
      if (json.hasClaimed) {
        setClaimMessage("You have already claimed on this market.");
      } else if (json.canClaim && claimSol > 0) {
        setClaimMessage(
          `You can claim ~${claimSol.toFixed(4)} SOL${
            json.isTie ? " (refund)" : ""
          }.`
        );
      } else {
        setClaimMessage("Looks like you didn't win this time.");
      }
    } catch (e: any) {
      console.error("check win error:", e);
      setClaimMessage(e?.message ?? "Check win failed");
      setClaimPreview(null);
    } finally {
      setCheckingWin(false);
    }
  };
  

  // ---- FINALIZE ----
  const handleFinalize = async () => {
    try {
      setFinalizeLoading(true);
      setBuyMessage(null);

      const res = await fetch(`/api/markets/${slug}/finalize`, {
        method: "POST",
      });

      const text = await res.text();

      if (!res.ok) {
        setBuyMessage(`Finalize failed: ${text}`);
        return;
      }

      const json = JSON.parse(text);

    let winnerLabel = "Tie · refunds";
    if (json.winningSide === 1) winnerLabel = uiMarket?.sideA ?? "Side A";
    if (json.winningSide === 2) winnerLabel = uiMarket?.sideB ?? "Side B";

    setBuyMessage(`Market finalized. ${winnerLabel}.`);
    } catch (e: any) {
      console.error("Finalize error:", e);
      setBuyMessage("Finalize failed: " + (e?.message ?? "Unknown error"));
    } finally {
      setFinalizeLoading(false);
    }
  };

  // ---- CLAIM ----
  const handleClaim = async () => {
    if (!uiMarket) return;
    if (!wallet.publicKey || !wallet.signTransaction) {
      setClaimMessage("Connect a wallet that can sign transactions.");
      return;
    }

    try {
      setClaimLoading(true);
      setClaimMessage(null);

      const res = await fetch(`/api/markets/${slug}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: wallet.publicKey.toBase58() }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        const errMsg =
          json?.error || json?.message || "Claim API error";
        setClaimMessage(`Claim failed: ${errMsg}`);
        return;
      }

      const txBuf = Buffer.from(json.tx, "base64");
      const tx = Transaction.from(txBuf);

      tx.feePayer = wallet.publicKey;

      const signedTx = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(
        signedTx.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: "confirmed",
        }
      );
      await connection.confirmTransaction(sig, "confirmed");

      const claimLamports = json.claimAmount
        ? Number(json.claimAmount)
        : null;
      const claimSol =
        claimLamports && Number.isFinite(claimLamports)
          ? claimLamports / LAMPORTS_PER_SOL
          : null;

      setClaimMessage(
        claimSol
          ? `Claimed ~${claimSol.toFixed(4)} SOL. Tx: ${sig}`
          : `Claim transaction sent. Tx: ${sig}`
      );

      setClaimPreview((prev) =>
        prev ? { ...prev, hasClaimed: true, canClaim: false } : prev
      );
    } catch (e: any) {
      console.error("claim error:", e);
      setClaimMessage(e?.message ?? "Claim failed");
    } finally {
      setClaimLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    let first = true;
  
    const loadMarket = async () => {
      try {
        const marketDataPk = new PublicKey(slug);
        const account: any = await program.account.marketData.fetch(
          marketDataPk
        );
  
        const ticketPriceLamports = (account.ticketPrice as BN).toNumber();
        const totalAmountLamports = (account.totalAmount as BN).toNumber();
        const duration = (account.duration as BN).toNumber();
        const creationTime = (account.creationTime as BN).toNumber();
        const totalTickets = (account.totalTickets as BN).toNumber();
        const ticketsA = (account.totalTicketsSideA as BN).toNumber();
        const ticketsB = (account.totalTicketsSideB as BN).toNumber();
        const winningSideNum = Number(account.winningSide) as 0 | 1 | 2;
  
        const endTs = creationTime + duration;
  
        const ticketPriceSol = ticketPriceLamports / LAMPORTS_PER_SOL;
        const poolSol = totalAmountLamports / LAMPORTS_PER_SOL;
  
        const isFinalized: boolean = account.isFinalized;
  
        let sideAPercent = 50;
        let sideBPercent = 50;
  
        if (isFinalized && totalTickets > 0) {
          sideAPercent = (ticketsA / totalTickets) * 100;
          sideBPercent = 100 - sideAPercent;
        }
  
        const treasuryPubkey = new PublicKey(account.treasuryAddress);
        const treasuryBalanceLamports = await connection.getBalance(
          treasuryPubkey
        );
        const treasurySol = treasuryBalanceLamports / LAMPORTS_PER_SOL;
  
        if (cancelled) return;
  
        setUiMarket({
          title: account.title as string,
          description: account.description as string,
          sideA: account.sideA as string,
          sideB: account.sideB as string,
          ticketPriceSol,
          poolSol,
          treasurySol,
          endTs,
          isFinalized,
          winningSide: winningSideNum,
          totalTickets,
          totalTicketsSideA: ticketsA,
          totalTicketsSideB: ticketsB,
          sideAPercent,
          sideBPercent,
        });
      } catch (e: any) {
        console.error("Error loading market:", e);
        if (!cancelled && first) {
          setError(e?.message ?? "Failed to load market");
        }
      } finally {
        if (!cancelled && first) {
          setLoading(false);
          first = false;
        }
      }
    };
  
    setLoading(true);
    loadMarket();
  
    const id = setInterval(loadMarket, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [slug, program, connection]);

  useEffect(() => {
    if (!wallet.publicKey) {
      setClaimPreview(null);
      return;
    }
    if (!uiMarket?.isFinalized) return;
  
    runCheckWin();
  }, [wallet.publicKey, slug, uiMarket?.isFinalized]);
  
  // ---- RENDER ----
  if (loading) {
    return (
      <section className="pt-10">
        <div className="max-w-6xl mx-auto text-sm text-zinc-500">
          Loading market…
        </div>
      </section>
    );
  }

  if (error || !uiMarket) {
    return (
      <section className="pt-10">
        <div className="max-w-6xl mx-auto text-sm text-red-400">
          Failed to load market: {error ?? "Unknown error"}
        </div>
      </section>
    );
  }

  const endTs = uiMarket.endTs;
  const hasEnded = nowTs >= endTs;
  const isFinalized = uiMarket.isFinalized;

  const phase: MarketPhase = 
    isFinalized
        ? "FINALIZED"
        : hasEnded
        ? "AWAIT_FINALIZE"
        : "OPEN";

  const timeLeftLabel =
    phase === "FINALIZED"
        ? "Settled"
        : phase === "AWAIT_FINALIZE"
        ? "Awaiting finalize"
        : formatTimeLeft(endTs, nowTs);

  const isLastMinute = phase === "OPEN" && endTs - nowTs <= 60;

  const isTie = uiMarket.isFinalized && uiMarket.winningSide === 0;
  const isSideAWinner = uiMarket.isFinalized && uiMarket.winningSide === 1;
  const isSideBWinner = uiMarket.isFinalized && uiMarket.winningSide === 2;

  const canInteractSides = phase === "OPEN";
  const leftPercent = uiMarket.sideAPercent;
  const rightPercent = uiMarket.sideBPercent;

  return (
    <section className="pt-10">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="space-y-4 max-w-xl">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">
              Market
            </p>
            <h1 className="text-3xl md:text-4xl font-medium">
              {uiMarket.title}
            </h1>
            <p className="text-sm text-zinc-400">
              {uiMarket.description}
            </p>
          </div>

          <div className="text-xs text-zinc-500 space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="uppercase tracking-[0.22em]">Pool</span>
              <span className="text-sm text-zinc-50">
                {uiMarket.poolSol.toFixed(2)} SOL
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="uppercase tracking-[0.22em]">
                Remaining treasury
              </span>
              <span className="text-sm text-zinc-50">
                ~{uiMarket.treasurySol.toFixed(2)} SOL
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
            <span className="uppercase tracking-[0.22em]">Status</span>
              <span
                className={
                    "text-sm " +
                    (isLastMinute ? "text-amber-400" : "text-zinc-50")
                }
                >
                {timeLeftLabel}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="uppercase tracking-[0.22em]">
                Ticket price
              </span>
              <span className="text-sm text-zinc-50">
                {uiMarket.ticketPriceSol.toFixed(3)} SOL
              </span>
            </div>
            {uiMarket.isFinalized && (
              <div className="flex items-center justify-between gap-4">
                <span className="uppercase tracking-[0.22em]">Winner</span>
                  <span className="text-sm text-zinc-50">
                    {uiMarket.winningSide === 0
                        ? "Tie · refunds"
                        : uiMarket.winningSide === 1
                        ? uiMarket.sideA
                        : uiMarket.sideB}
                  </span>
              </div>
            )}
          </div>
        </div>

        {/* Split visual */}
        <div className="relative overflow-hidden rounded-4xl border border-zinc-800/80 bg-zinc-900">
          <div className="grid md:grid-cols-2 min-h-[320px]">
            {/* Left side */}
            <button
                type="button"
                onClick={canInteractSides ? () => setSelectedSide("a") : undefined}
                disabled={!canInteractSides}
                className={[
                    "relative flex flex-col justify-between p-6 md:p-8 text-left",
                    "bg-gradient-to-br",
                    sideColors.a,
                    "transform transition-all duration-500 ease-out",
                    !uiMarket.isFinalized
                    ? selectedSide === "a"
                        ? "scale-[1] shadow-[0_18px_40px_rgba(15,23,42,0.6)] z-10"
                        : "scale-[1] opacity-30 hover:opacity-60"
                    : isTie
                    ? "opacity-40 cursor-default"
                    : isSideAWinner
                    ? "opacity-100 cursor-default"
                    : "opacity-20 grayscale cursor-default",
                ].join(" ")}
                >
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-zinc-50/80">
                    <span></span>
                    <span>Side A</span>
                </div>
                <div className="flex-1 flex items-center">
                    <p className="text-3xl md:text-4xl lg:text-5xl font-medium text-zinc-50 text-right w-full">
                    {uiMarket.sideA}
                    </p>
                </div>
                <p className="text-[11px] text-zinc-50/80 uppercase tracking-[0.24em] text-right w-full">
                    {!uiMarket.isFinalized
                    ? "Tap to back this side"
                    : isTie
                    ? "Market ended in a tie"
                    : isSideAWinner
                    ? "Winning side"
                    : "Losing side"}
                </p>
            </button>

            {/* Right side */}
            <button
                type="button"
                onClick={canInteractSides ? () => setSelectedSide("b") : undefined}
                disabled={!canInteractSides}
                className={[
                    "relative flex flex-col justify-between p-6 md:p-8 text-left",
                    "bg-gradient-to-bl",
                    sideColors.b,
                    "transform transition-all duration-500 ease-out",
                    !uiMarket.isFinalized
                    ? selectedSide === "b"
                        ? "scale-[1] shadow-[0_18px_40px_rgba(15,23,42,0.6)] z-10"
                        : "scale-[1] opacity-30 hover:opacity-60"
                    : isTie
                    ? "opacity-40 cursor-default"
                    : isSideBWinner
                    ? "opacity-100 cursor-default"
                    : "opacity-20 grayscale cursor-default",
                ].join(" ")}
                >
                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.24em] text-zinc-50/80">
                    <span>Side B</span>
                    <span></span>
                </div>
                <div className="flex-1 flex items-center">
                    <p className="text-3xl md:text-4xl lg:text-5xl font-medium text-zinc-50">
                    {uiMarket.sideB}
                    </p>
                </div>
                <p className="text-[11px] text-zinc-50/80 uppercase tracking-[0.24em]">
                    {!uiMarket.isFinalized
                    ? "Tap to back this side"
                    : isTie
                    ? "Market ended in a tie"
                    : isSideBWinner
                    ? "Winning side"
                    : "Losing side"}
                </p>
            </button>
          </div>
        </div>

        {/* Total pool pill */}
        <div className="relative flex justify-center -mt-4">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-8 bg-gradient-to-r from-[#9945FF33] via-[#14F19533] to-[#00C2FF33] blur-xl" />
          <div className="relative flex flex-col items-center gap-1 rounded-lg px-5 py-2.5 ">
            <span className="text-[10px] uppercase tracking-[0.26em] text-zinc-500">
              Total pool
            </span>
            <span
              className="
                text-lg md:text-4xl font-medium
                bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#00C2FF]
                bg-clip-text text-transparent
                drop-shadow-[0_0_16px_rgba(20,241,149,0.35)]
              "
            >
              {uiMarket.poolSol.toFixed(2)} SOL
            </span>
          </div>
        </div>

        {/* Finalize callout */}
        {phase === "AWAIT_FINALIZE" && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-amber-300">
                Finalization window
              </p>
              <p className="text-amber-100/90">
                Anyone can trigger settlement once the timer is over. The
                project-owner wallet will compute winners off-chain and publish
                results on-chain.
              </p>
            </div>
            <button
              onClick={handleFinalize}
              disabled={finalizeLoading}
              className="shrink-0 rounded-full border border-amber-300/80 bg-amber-300 text-amber-950 px-6 py-2 text-[11px] tracking-[0.24em] uppercase hover:bg-transparent hover:text-amber-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {finalizeLoading ? "Finalizing..." : "Finalize market"}
            </button>
          </div>
        )}

        {uiMarket.isFinalized && (
        <div className="w-full flex justify-center">
            <div className="w-full max-w-xl rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 sm:px-6 sm:py-5 space-y-3 text-xs">
            <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                {uiMarket.winningSide === 0 ? "Tie · refunds" : "Claims open"}
                </p>
                <p className="text-emerald-100/90">
                {uiMarket.winningSide === 0
                    ? "Market ended in a tie. You can refund your contribution (no fee taken)."
                    : "If you backed the winning side, you can now claim your share of the pool. The program will route a small fee to the project treasury."}
                </p>
                {claimMessage && (
                <p className="text-[11px] text-emerald-200/90 pt-1 break-all">
                    {claimMessage}
                </p>
                )}
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                <button
                onClick={runCheckWin}
                disabled={checkingWin || !wallet.publicKey}
                className="w-full sm:w-auto rounded-full border border-emerald-300/60 px-4 py-2 text-[10px] uppercase tracking-[0.2em] text-emerald-200 hover:bg-emerald-300/10 disabled:opacity-50"
                >
                {checkingWin ? "Checking..." : "Check my win"}
                </button>

                <button
                onClick={handleClaim}
                disabled={
                    claimLoading ||
                    !wallet.publicKey ||
                    !uiMarket.isFinalized ||
                    (claimPreview
                    ? !claimPreview.canClaim || claimPreview.hasClaimed
                    : false)
                }
                className="w-full sm:w-auto rounded-full border border-emerald-300/80 bg-emerald-300 text-emerald-950 px-6 py-2 text-[11px] tracking-[0.24em] uppercase hover:bg-transparent hover:text-emerald-100 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                {!wallet.publicKey
                    ? "Connect wallet"
                    : claimLoading
                    ? "Claiming..."
                    : claimPreview?.hasClaimed
                    ? "Already claimed"
                    : claimPreview && !claimPreview.canClaim
                    ? "Nothing to claim"
                    : "Claim reward"}
                </button>
            </div>
            </div>
        </div>
        )}

        {/* Bottom: buy tickets */}
        {phase === "OPEN" && (
        <div className="grid gap-8 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
          <div className="space-y-4">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">
              Choose side & size
            </p>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setSelectedSide("a")}
                className={[
                  "rounded-full border px-5 py-2 text-xs tracking-[0.2em] uppercase transition-colors duration-300",
                  selectedSide === "a"
                    ? "border-zinc-50 bg-zinc-50 text-zinc-900"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-50 hover:border-zinc-300",
                ].join(" ")}
              >
                Back {uiMarket.sideA}
              </button>
              <button
                type="button"
                onClick={() => setSelectedSide("b")}
                className={[
                  "rounded-full border px-5 py-2 text-xs tracking-[0.2em] uppercase transition-colors duration-300",
                  selectedSide === "b"
                    ? "border-zinc-50 bg-zinc-50 text-zinc-900"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-50 hover:border-zinc-300",
                ].join(" ")}
              >
                Back {uiMarket.sideB}
              </button>
            </div>

            <div className="space-y-4 w-full md:max-w-sm">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Tickets to buy
                </label>
                <div className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-4 py-3">
                  <input
                    type="number"
                    min={1}
                    value={tickets}
                    onChange={(e) =>
                      setTickets(Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-24 bg-transparent text-sm outline-none text-zinc-50"
                  />
                  <div className="flex flex-col text-xs text-zinc-400">
                    <span>
                      1 ticket = {uiMarket.ticketPriceSol.toFixed(3)} SOL
                    </span>
                    <span>
                      Est. cost ·{" "}
                      <span className="text-zinc-50">
                        {estimatedCost.toFixed(3)} SOL
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {buyMessage && (
                <p className="text-xs text-zinc-400">{buyMessage}</p>
              )}

              <button
                onClick={handleBuy}
                disabled={buyLoading}
                className="w-full rounded-full bg-zinc-50 text-zinc-900 px-10 py-3 text-[11px] tracking-[0.3em] uppercase border border-zinc-50 hover:bg-transparent hover:text-zinc-50 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {buyLoading ? "Processing..." : "Confirm side & buy"}
              </button>
            </div>
          </div>

          <div className="space-y-4 text-xs text-zinc-400">
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">
              Market information
            </p>
            <p>
              This UI keeps votes hidden on-chain by storing only encrypted
              hashes. The backend uses a per-market encryptor key to encode
              your side before sending it to the program.
            </p>
            <p>
              After the timer ends, anyone can trigger a finalize action via the
              backend. It reveals the encryptor on-chain, computes winners
              off-chain, and then opens up claims with a protocol fee.
            </p>
          </div>
        </div>
        )}

        {/* Local ticket summary */}
        <div className="mt-6 space-y-3 w-1/2 mx-auto">
          <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">
            Your tickets (local)
          </p>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 space-y-4">
            {!wallet.publicKey ? (
              <p className="text-xs text-zinc-500">
                Connect wallet to track your tickets for this market on this
                device.
              </p>
            ) : totalTickets === 0 ? (
              <p className="text-xs text-zinc-500">
                No tickets recorded locally for this wallet on this market yet.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Side A card */}
                  <div className="relative rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 overflow-hidden">
                    <div
                      className={[
                        "pointer-events-none absolute inset-0 opacity-25",
                        "bg-gradient-to-br",
                        sideColors.a,
                      ].join(" ")}
                    />
                    <div className="relative space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-400">
                        Side A
                      </p>
                      <p className="text-2xl font-medium text-zinc-50">
                        {totalTicketsA}
                        <span className="text-sm text-zinc-400 ml-1">
                          ticket{totalTicketsA !== 1 ? "s" : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        ≈{" "}
                        {(
                          totalTicketsA * uiMarket.ticketPriceSol
                        ).toFixed(3)}{" "}
                        SOL
                      </p>
                    </div>
                  </div>

                  {/* Side B card */}
                  <div className="relative rounded-2xl border border-zinc-800 bg-zinc-950/90 p-4 overflow-hidden">
                    <div
                      className={[
                        "pointer-events-none absolute inset-0 opacity-25",
                        "bg-gradient-to-br",
                        sideColors.b,
                      ].join(" ")}
                    />
                    <div className="relative space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.26em] text-zinc-400">
                        Side B
                      </p>
                      <p className="text-2xl font-medium text-zinc-50">
                        {totalTicketsB}
                        <span className="text-sm text-zinc-400 ml-1">
                          ticket{totalTicketsB !== 1 ? "s" : ""}
                        </span>
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        ≈{" "}
                        {(
                          totalTicketsB * uiMarket.ticketPriceSol
                        ).toFixed(3)}{" "}
                        SOL
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1">
                  <span></span>
                  <span>
                    {totalTickets} tickets · ~{" "}
                    {(totalTickets * uiMarket.ticketPriceSol).toFixed(3)} SOL
                  </span>
                </div>
              </>
            )}

            <p className="text-[10px] text-zinc-600">
              Stored only in your browser - does not affect on-chain balances.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
