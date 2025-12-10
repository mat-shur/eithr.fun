"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { AnchorProvider, Idl, Program } from "@project-serum/anchor";

import { eithrFunIdl } from "../data/idl_type";

// === On-chain config ===
import { PROGRAM_ID } from "../data/program";
const LAMPORTS_PER_SOL = 1_000_000_000;

// === UI types ===
type MarketStatus = "live" | "upcoming" | "resolved";

type UIMarket = {
  address: string; // MarketData PDA
  title: string;
  subtitle: string;
  category: string;
  status: MarketStatus;
  poolSol: number;
  timeLeft: string;
};

const CATEGORY_FILTERS = ["All", "Culture", "Lifestyle", "Crypto", "Politics"];
const STATUS_FILTERS = ["All", "Live", "Upcoming", "Resolved"];


function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return "Ended";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;

  return `${Math.floor(seconds)}s`;
}

export default function MarketsPage() {
  const { connection } = useConnection();

  const [category, setCategory] = useState<string>("All");
  const [status, setStatus] = useState<string>("Live");

  const [markets, setMarkets] = useState<UIMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Anchor provider + program (read-only) ---
  const provider = useMemo(
    () =>
      new AnchorProvider(
        connection,
        {} as any,
        { commitment: "confirmed" }
      ),
    [connection]
  );

  const program = useMemo(
    () => new Program(eithrFunIdl as Idl, PROGRAM_ID, provider),
    [provider]
  );

  // --- Fetch all MarketData accounts on mount ---
  useEffect(() => {
    let cancelled = false;

    const fetchMarkets = async () => {
      setLoading(true);
      setError(null);

      try {
        const all = await program.account.marketData.all();

        const nowSec = Date.now() / 1000;

        const uiMarkets: UIMarket[] = all.map(({ publicKey, account }: any) => {
          const creationTime = Number(account.creationTime ?? 0);
          const duration = Number(account.duration ?? 0);
          const endTime = creationTime + duration;

          const isFinalized: boolean = account.isFinalized;
          let uiStatus: MarketStatus;
          let timeLeft: string;

          if (isFinalized) {
            uiStatus = "resolved";
            timeLeft = "Settled";
          } else {
            const secsLeft = endTime - nowSec;

            uiStatus = "live";
            timeLeft =
              secsLeft > 0
                ? formatTimeLeft(secsLeft)
                : "Ended, awaiting reveal";
          }

          const totalAmountLamports = Number(account.totalAmount ?? 0);
          const poolSol = totalAmountLamports / LAMPORTS_PER_SOL;

          return {
            address: publicKey.toBase58(),
            title: account.title as string,
            subtitle: account.description as string,
            category: account.category as string,
            status: uiStatus,
            poolSol,
            timeLeft,
          };
        });

        const statusOrder: MarketStatus[] = ["live", "upcoming", "resolved"];
        uiMarkets.sort((a, b) => {
          const sa = statusOrder.indexOf(a.status);
          const sb = statusOrder.indexOf(b.status);
          return sa - sb;
        });

        if (!cancelled) {
          setMarkets(uiMarkets);
        }
      } catch (e: any) {
        console.error("Failed to fetch markets:", e);
        if (!cancelled) {
          setError(e?.message ?? "Failed to load markets");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchMarkets();

    return () => {
      cancelled = true;
    };
  }, [program]);

  // --- Filtering ---
  const filtered = markets.filter((m) => {
    const categoryOk = category === "All" || m.category === category;
    const statusOk =
      status === "All" ||
      m.status === status.toLowerCase();
    return categoryOk && statusOk;
  });

  return (
    <section className="pt-10">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500 mb-3">
              Explore
            </p>
            <h1 className="text-3xl md:text-4xl font-medium text-zinc-50">
              Markets powered by internet arguments
            </h1>
            <p className="mt-2 text-xs text-zinc-500">
              {loading
                ? "Loading on-chain markets…"
                : `Found ${markets.length} on-chain market${
                    markets.length === 1 ? "" : "s"
                  }`}
            </p>
            {error && (
              <p className="mt-1 text-xs text-red-400">
                Failed to load markets: {error}
              </p>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-4 md:items-end">
            {/* Category filter */}
            {/* <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.24em] uppercase text-zinc-500">
              <span>Category</span>
              <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-900/60">
                {CATEGORY_FILTERS.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(cat)}
                    className={[
                      "px-4 py-1 rounded-full text-[10px] transition-colors duration-300",
                      category === cat
                        ? "bg-zinc-50 text-zinc-900"
                        : "text-zinc-400 hover:text-zinc-50",
                    ].join(" ")}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div> */}

            {/* Status filter */}
            <div className="inline-flex items-center gap-2 text-[11px] tracking-[0.24em] uppercase text-zinc-500">
              <span>Status</span>
              <div className="inline-flex rounded-full border border-zinc-800 bg-zinc-900/60">
                {STATUS_FILTERS.map((st) => (
                  <button
                    key={st}
                    onClick={() => setStatus(st)}
                    className={[
                      "px-4 py-1 rounded-full text-[10px] transition-colors duration-300",
                      status === st
                        ? "bg-zinc-50 text-zinc-900"
                        : "text-zinc-400 hover:text-zinc-50",
                    ].join(" ")}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid gap-6 md:gap-8 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.length === 0 && !loading && (
            <div className="col-span-full text-sm text-zinc-500">
              No markets match your filters yet.
            </div>
          )}

          {filtered.map((market) => (
            <Link key={market.address} href={`/markets/${market.address}`}>
              <div className="relative group">
                {/* Glow / gradient behind card */}
                <div className="pointer-events-none absolute -inset-[1px] rounded-3xl bg-gradient-to-br from-[#9945FF33] via-[#14F19533] to-[#00C2FF33] opacity-100 blur-xl transition-opacity duration-500" />

                <article className="relative aspect-[16/10] rounded-3xl border border-transparent bg-black p-5 flex flex-col justify-between overflow-hidden transition-transform duration-500 group-hover:-translate-y-1">
                  <div className="flex justify-between items-center text-[11px] tracking-[0.24em] uppercase text-zinc-500">
                    <span className="text-zinc-500/80">
                      {market.category || "Uncategorized"}
                    </span>
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5 text-[10px]",
                        market.status === "live"
                          ? "border-emerald-500 text-emerald-400"
                          : market.status === "resolved"
                          ? "border-zinc-500 text-zinc-400"
                          : "border-amber-500 text-amber-400",
                      ].join(" ")}
                    >
                      {market.status}
                    </span>
                  </div>

                  <div className="mt-2 space-y-2">
                    <div>
                      <h2 className="text-xl md:text-2xl font-medium leading-tight text-zinc-50">
                        {market.title}
                      </h2>
                      <div className="mt-1 h-px w-12 bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#00C2FF]" />
                    </div>
                    <p className="text-sm text-zinc-400 line-clamp-2">
                      {market.subtitle}
                    </p>
                  </div>

                  <div className="mt-4 flex items-end justify-between text-xs text-zinc-500">
                    <div className="space-y-1">
                      <p className="uppercase tracking-[0.2em]">Pool</p>
                      <p className="text-sm text-zinc-50">
                        {market.poolSol.toFixed(3)} SOL
                      </p>
                    </div>
                    <div className="space-y-1 text-right">
                      <p className="uppercase tracking-[0.2em]">
                        {market.status === "resolved"
                          ? "Finalized"
                          : "Time left"}
                      </p>
                      <p className="text-sm text-zinc-50">
                        {market.timeLeft}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 h-[1px] w-full bg-gradient-to-r from-[#9945FF44] via-[#14F19566] to-[#00C2FF44]" />

                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_55%)] opacity-100" />
                </article>
              </div>
            </Link>
          ))}
        </div>

        <p className="text-xs text-zinc-500 text-right">
          Need something even spicier?&nbsp;
          <Link
            href="/create"
            className="underline underline-offset-4 decoration-zinc-600 hover:text-zinc-50"
          >
            Create your own market
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
