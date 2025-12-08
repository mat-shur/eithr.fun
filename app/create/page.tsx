"use client";

import { useMemo, useState } from "react";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { AnchorProvider, BN, Idl, Program } from "@project-serum/anchor";

import { eithrFunIdl } from "../data/idl_type"; 

const CATEGORY_OPTIONS = ["Culture", "Crypto", "Sports", "Lifestyle", "Politics"];

const PROGRAM_ID = new PublicKey(
  "4dZuWfAH3HeU79Bd1ajUgr4RM2gGJywH2wHQfG8wQeAV"
);
const LAMPORTS_PER_SOL = 1_000_000_000;

type ResultState = "idle" | "success" | "error";
type DurationUnit = "minutes" | "hours";

function generateEncryptorKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default function CreateMarketPage() {
  // --- Form state ---
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sideA, setSideA] = useState("");
  const [sideB, setSideB] = useState("");
  const [ticketPrice, setTicketPrice] = useState("0.01");

  const [durationValue, setDurationValue] = useState("24");
  const [durationUnit, setDurationUnit] = useState<DurationUnit>("hours");

  const [category, setCategory] = useState("Culture");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [creatorLiquidity, setCreatorLiquidity] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [marketAddress, setMarketAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultState>("idle");

  const { connection } = useConnection();
  const wallet = useWallet();

  const provider = useMemo(() => {
    return new AnchorProvider(
      connection,
      wallet as any,
      { commitment: "confirmed" }
    );
  }, [connection, wallet]);

  const program = useMemo(
    () => new Program(eithrFunIdl as Idl, PROGRAM_ID, provider),
    [provider]
  );

  const handleCreate = async () => {
    setError(null);
    setTxSig(null);
    setMarketAddress(null);
    setResult("idle");

    if (!wallet.connected || !wallet.publicKey) {
      setError("Connect wallet first.");
      setResult("error");
      return;
    }

    if (!title.trim() || !sideA.trim() || !sideB.trim()) {
      setError("Please fill in title and both sides.");
      setResult("error");
      return;
    }

    if (!description.trim()) {
      setError("Please add a short description.");
      setResult("error");
      return;
    }

    let ticketPriceSol = parseFloat(ticketPrice);
    if (isNaN(ticketPriceSol) || ticketPriceSol <= 0) {
      setError("Ticket price must be a positive number.");
      setResult("error");
      return;
    }

    let duration = parseFloat(durationValue);
    if (isNaN(duration) || duration <= 0) {
      setError("Duration must be a positive number.");
      setResult("error");
      return;
    }

    try {
      setSubmitting(true);

      const ticketPriceLamports = new BN(
        Math.round(ticketPriceSol * LAMPORTS_PER_SOL)
      );

      let multiplier: number;

      switch (durationUnit) {
        case "minutes":
          multiplier = 60;
          break;
        case "hours":
        default:
          multiplier = 3600;
          break;
      }

      const durationSeconds = new BN(Math.round(duration * multiplier));

      const marketKey = Keypair.generate();

      const [marketDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market_data"), marketKey.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const [treasuryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("treasury_account"), marketKey.publicKey.toBuffer()],
        PROGRAM_ID
      );

      const encryptorKey = generateEncryptorKey();

      const registerRes = await fetch("/api/markets/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketData: marketDataPda.toBase58(),
          marketKey: marketKey.publicKey.toBase58(),
          encryptorKey,
        }),
      });

      if (!registerRes.ok) {
        const text = await registerRes.text();
        throw new Error(`Failed to register encryptor: ${text}`);
      }

      console.log("Creating market with:");
      console.log("marketKey:", marketKey.publicKey.toBase58());
      console.log("marketDataPda:", marketDataPda.toBase58());
      console.log("treasuryPda:", treasuryPda.toBase58());

      const sig = await program.methods
        .initializeMarket(
          title.trim(),
          description.trim(),
          sideA.trim(),
          sideB.trim(),
          ticketPriceLamports,
          category.trim(),
          durationSeconds
        )
        .accounts({
          payer: wallet.publicKey,
          marketData: marketDataPda,
          marketKey: marketKey.publicKey,
          treasuryAccount: treasuryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("InitializeMarket tx:", sig);

      setTxSig(sig);
      setMarketAddress(marketDataPda.toBase58());
      setResult("success");
    } catch (e: any) {
      console.error("Failed to create market:", e);
      setError(e?.message ?? "Failed to create market.");
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="pt-10">
      <div className="max-w-6xl mx-auto grid gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)]">
        {/* Left: copy / explanation */}
        <div className="space-y-8">
          <div>
            <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500 mb-3">
              Create
            </p>
            <div className="space-y-3">
              <h1 className="text-3xl md:text-4xl font-medium text-zinc-50">
                Launch a new either / or market.
              </h1>
              <div className="h-px w-20 bg-gradient-to-r from-[#9945FF] via-[#14F195] to-[#00C2FF]" />
            </div>
          </div>

          <div className="space-y-4 text-sm text-zinc-400">
            <p>
              Every eithr.fun market has only two sides. Users buy tickets in
              SOL (0.01 per ticket yet) on one side. Once the countdown hits zero, the side with
              more tickets wins and splits a percentage of the losing pool.
            </p>
            <p>
              Keep it playful and unambiguous: think{" "}
              <span className="font-medium text-zinc-50">Cat vs Dog</span>,{" "}
              <span className="font-medium text-zinc-50">
                This week: BTC vs ETH
              </span>
              , or{" "}
              <span className="font-medium text-zinc-50">
                Rain vs No Rain on Friday
              </span>
              .
            </p>
            <p className="text-xs text-zinc-500">
              Avoid real-money betting expectations, sensitive outcomes,
              or anything that breaks your hackathon&apos;s rules.
            </p>
          </div>

          <ol className="space-y-2 text-sm text-zinc-400">
            <li>1. Name both sides.</li>
            <li>2. Set how long people can join (duration).</li>
            <li>3. Create!</li>
          </ol>

          {/* Status / feedback block */}
          <div className="mt-6 space-y-3 text-xs text-zinc-500">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3 space-y-1">
              <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-600">
                Connected wallet
              </p>
              <p className="font-mono text-[11px] text-zinc-300 break-all">
                {wallet.connected && wallet.publicKey
                  ? wallet.publicKey.toBase58()
                  : "Not connected"}
              </p>
            </div>

            {result === "success" && txSig && (
              <div className="rounded-2xl border border-emerald-500/50 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent px-4 py-4 md:px-5 md:py-5 space-y-3 shadow-[0_0_40px_rgba(16,185,129,0.25)]">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/25">
                    <span className="text-lg text-emerald-100">✓</span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-[0.26em] text-emerald-200">
                      Result · Success
                    </p>
                    <p className="text-[11px] text-emerald-100/90">
                      Your either / or arena is now live on Solana devnet.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 text-[11px] md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-zinc-400 uppercase tracking-[0.18em]">
                      Transaction
                    </p>
                    <a
                      href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100 underline underline-offset-2 decoration-emerald-400/70"
                    >
                      View on Solana Explorer
                      <span className="text-[10px]">↗</span>
                    </a>
                  </div>

                  {marketAddress && (
                    <div className="space-y-1">
                      <p className="text-zinc-400 uppercase tracking-[0.18em]">
                        Market page
                      </p>
                      <a
                        href={`/markets/${marketAddress}`}
                        className="inline-flex items-center gap-1 text-emerald-200 hover:text-emerald-100 underline underline-offset-2 decoration-emerald-400/70"
                      >
                        Open on eithr.fun
                        <span className="text-[10px]">↗</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {result === "error" && error && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-1 text-[11px] text-red-200">
                <p className="text-[10px] uppercase tracking-[0.22em] text-red-300">
                  Result · Failed
                </p>
                <p>{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: form */}
        <div className="relative">
          <div className="pointer-events-none absolute -inset-[1px] rounded-[2rem] bg-gradient-to-br from-[#9945FF44] via-[#14F19544] to-[#00C2FF44] opacity-70 blur-md" />
          <div className="relative rounded-[2rem] border border-zinc-800 bg-zinc-950/70 p-6 md:p-8 space-y-6 backdrop-blur-md">
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-zinc-500">
              <span>Market details</span>
              <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px]">
                On-chain
              </span>
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Market title
              </label>
              <input
                placeholder="Cat vs Dog"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                Short description
              </label>
              <textarea
                rows={3}
                placeholder="Which side wins the eternal internet war?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10 resize-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Side A
                </label>
                <input
                  placeholder="Cat"
                  value={sideA}
                  onChange={(e) => setSideA(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Side B
                </label>
                <input
                  placeholder="Dog"
                  value={sideB}
                  onChange={(e) => setSideB(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                />
              </div>
            </div>

            <div className="border-t border-zinc-800/80 pt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Category
                </label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCategoryOpen((o) => !o)}
                    className="w-full rounded-2xl border border-zinc-800 bg-black/40 px-4 py-3 text-sm text-zinc-50 outline-none flex items-center justify-between gap-2 hover:border-zinc-50/60 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                  >
                    <span>{category}</span>
                    <span className="text-[10px] text-zinc-500">▼</span>
                  </button>

                  {categoryOpen && (
                    <div className="absolute z-20 mt-1 w-full rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-xl overflow-hidden">
                      {CATEGORY_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => {
                            setCategory(opt);
                            setCategoryOpen(false);
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm ${
                            opt === category
                              ? "bg-zinc-900 text-zinc-50"
                              : "text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-50"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Duration
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    min={1}
                    value={durationValue}
                    onChange={(e) => setDurationValue(e.target.value)}
                    className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                    placeholder="e.g. 30"
                  />

                  <div className="flex shrink-0 rounded-2xl border border-zinc-800 bg-black/60 p-1 text-[10px] uppercase tracking-[0.18em]">
                    {(["minutes", "hours"] as DurationUnit[]).map((unit) => {
                      const active = durationUnit === unit;
                      return (
                        <button
                          key={unit}
                          type="button"
                          onClick={() => setDurationUnit(unit)}
                          className={
                            "px-3 py-1.5 rounded-2xl transition-colors " +
                            (active
                              ? "bg-zinc-50 text-zinc-900"
                              : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800/80")
                          }
                        >
                          {unit === "minutes" ? "MIN" : "HRS"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Ticket price (SOL)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  disabled
                  value={ticketPrice}
                  onChange={(e) => setTicketPrice(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-950/55 px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                />
              </div>
              {/* <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  Creator liquidity (SOL)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  placeholder="e.g. 5"
                  value={creatorLiquidity}
                  onChange={(e) => setCreatorLiquidity(e.target.value)}
                  className="w-full rounded-2xl border border-zinc-800 bg-transparent px-4 py-3 text-sm text-zinc-50 outline-none placeholder:text-zinc-600 focus:border-zinc-50/80 focus:ring-1 focus:ring-zinc-50/10"
                />
              </div> */}
            </div>

            <div className="space-y-2 text-xs text-zinc-500">
              <p>
                *the protocol automatically take a small fee from loser pool
                to fund future experiments.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-[0.26em]">
                On-chain market · tickets in SOL
              </p>

              <button
                disabled={submitting}
                onClick={handleCreate}
                className="rounded-full bg-zinc-50 text-zinc-900 px-8 py-3 text-[11px] font-medium tracking-[0.3em] uppercase border border-zinc-50 hover:bg-transparent hover:text-zinc-50 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? "Creating..." : "Create market"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
