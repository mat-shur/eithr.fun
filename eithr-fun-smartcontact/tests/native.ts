import BN from "bn.js";
import * as web3 from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import * as web3 from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import type { EithrFun } from "../target/types/eithr_fun";
declare function setTimeout(
  handler: (...args: any[]) => void,
  timeout?: number,
  ...args: any[]
): number;

describe("Test", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.EithrFun as anchor.Program<EithrFun>;
  
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());

  const payer = pg.wallet;

  const PROGRAM_OWNER = new web3.PublicKey(
    "8a6yEDSFf78hCbUz84jhfq7tkBMS91X1LrnyPiE8xUMo"
  );
  const PROJECT_TREASURY = new web3.PublicKey(
    "8a6yEDSFf78hCbUz84jhfq7tkBMS91X1LrnyPiE8xUMo"
  );


//   const marketKey = web3.Keypair.generate()

// console.log("market pubkey:", marketKey.publicKey.toBase58());
// console.log(
//   "market secret array:",
//   JSON.stringify(Array.from(marketKey.secretKey))
// );

const MARKET_SECRET = [65,6..];

const marketKey = web3.Keypair.fromSecretKey(
  Uint8Array.from(MARKET_SECRET)
);

console.log("market pubkey (restored):", marketKey.publicKey.toBase58());

  const [marketDataPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("market_data"), marketKey.publicKey.toBuffer()],
    program.programId
  );

  const [treasuryPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("treasury_account"), marketKey.publicKey.toBuffer()],
    program.programId
  );

  const [userTicketsPda] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user_tickets"), marketDataPda.toBuffer(), payer.publicKey.toBuffer()],
    program.programId
  );


  const TICKET_PRICE_LAMPORTS = new BN(
    anchor.web3.LAMPORTS_PER_SOL / 100
  ); // 0.01 SOL
  const DURATION_SECONDS = new BN(20); // 
  const BUY_TICKETS_COUNT = new BN(4); //

  // it("Initialize market", async () => {
  //   const title = "Test market";
  //   const description = "Just a simple test market";
  //   const sideA = "Cats";
  //   const sideB = "Dogs";
  //   const category = "fun";

  //   const accounts = {
  //     payer: payer.publicKey,
  //     marketData: marketDataPda,
  //     marketKey: marketKey.publicKey,
  //     treasuryAccount: treasuryPda,
  //     systemProgram: web3.SystemProgram.programId,
  //   };

  //   const tx = new Transaction();
  //   tx.add(
  //     ComputeBudgetProgram.setComputeUnitLimit({
  //       units: 300_000,
  //     })
  //   );

  //   const ix = await program.methods
  //     .initializeMarket(
  //       title,
  //       description,
  //       sideA,
  //       sideB,
  //       TICKET_PRICE_LAMPORTS,
  //       category,
  //       DURATION_SECONDS
  //     )
  //     .accounts(accounts)
  //     .instruction();

  //   tx.add(ix);

  //   const latestBlockhash = await program.provider.connection.getLatestBlockhash();
  //   tx.recentBlockhash = latestBlockhash.blockhash;
  //   tx.feePayer = payer.publicKey;

  //   try {
  //     const simulateResult = await anchor.utils.rpc.simulateTransaction(
  //       program.provider.connection,
  //       tx
  //     );
  //     if (simulateResult.value && simulateResult.value.logs) {
  //       console.log("InitializeMarket logs:", simulateResult.value.logs);
  //     }
  //   } catch (simError: any) {
  //     console.error("Simulation failed (initialize_market):", simError);
  //     if (simError.logs) {
  //       console.log("Simulation logs:", simError.logs);
  //     } else if (simError.error && simError.error.logs) {
  //       console.log("Simulation logs:", simError.error.logs);
  //     } else {
  //       console.log("No simulation logs available.");
  //     }
  //   }

  //   const result = await web3.sendAndConfirmTransaction(
  //     program.provider.connection,
  //     tx,
  //     [program.provider.wallet.payer]
  //   );

  //   console.log("Initialize market tx:", result);

  //   const market = await program.account.marketData.fetch(marketDataPda);
  //   console.log("Market after initialize:", {
  //     title: market.title,
  //     ticketPrice: market.ticketPrice.toString(),
  //     duration: market.duration.toString(),
  //     creator: market.creator.toBase58(),
  //     authority: market.authority.toBase58(),
  //     treasury: market.treasuryAddress.toBase58(),
  //   });
  // });

  // it("Buy tickets", async () => {
  //   const encodedSideHash = "deadbeefcafebabefeedface00000001"; // <=64 символів

  //   const accounts = {
  //     payer: payer.publicKey,
  //     marketKey: marketKey.publicKey,
  //     marketData: marketDataPda,
  //     treasuryAccount: treasuryPda,
  //     userTickets: userTicketsPda,
  //     systemProgram: web3.SystemProgram.programId,
  //   };

  //   const tx = new Transaction();
  //   tx.add(
  //     ComputeBudgetProgram.setComputeUnitLimit({
  //       units: 400_000,
  //     })
  //   );

  //   const ix = await program.methods
  //     .buyTickets(encodedSideHash, BUY_TICKETS_COUNT)
  //     .accounts(accounts)
  //     .instruction();

  //   tx.add(ix);

  //   const latestBlockhash = await program.provider.connection.getLatestBlockhash();
  //   tx.recentBlockhash = latestBlockhash.blockhash;
  //   tx.feePayer = payer.publicKey;

  //   try {
  //     const simulateResult = await anchor.utils.rpc.simulateTransaction(
  //       program.provider.connection,
  //       tx
  //     );
  //     if (simulateResult.value && simulateResult.value.logs) {
  //       console.log("BuyTickets logs:", simulateResult.value.logs);
  //     }
  //   } catch (simError: any) {
  //     console.error("Simulation failed (buy_tickets):", simError);
  //     if (simError.logs) {
  //       console.log("Simulation logs:", simError.logs);
  //     } else if (simError.error && simError.error.logs) {
  //       console.log("Simulation logs:", simError.error.logs);
  //     } else {
  //       console.log("No simulation logs available.");
  //     }
  //   }

  //   const result = await web3.sendAndConfirmTransaction(
  //     program.provider.connection,
  //     tx,
  //     [program.provider.wallet.payer]
  //   );

  //   console.log("Buy tickets tx:", result);

  //   const market = await program.account.marketData.fetch(marketDataPda);
  //   const userTickets = await program.account.userTickets.fetch(userTicketsPda);

  //   console.log("Market after buy:", {
  //     totalTickets: market.totalTickets.toString(),
  //     totalAmount: market.totalAmount.toString(),
  //   });
  //   console.log("UserTickets after buy:", {
  //     totalTickets: userTickets.totalTickets.toString(),
  //     totalAmount: userTickets.totalAmount.toString(),
  //     choicesLen: userTickets.choices.length,
  //   });
  // });

  it("Finalize market and claim reward", async () => {

    const marketBefore = await program.account.marketData.fetch(marketDataPda);

    console.log("Before finalize:", {
      totalTickets: marketBefore.totalTickets.toString(),
      totalAmount: marketBefore.totalAmount.toString(),
    });


    const totalTicketsSideA = marketBefore.totalTickets; // BN
    const totalTicketsSideB = new BN(0);

    const totalAmountSideA = marketBefore.totalAmount; 
    const totalAmountSideB = new BN(0);

    const winningSide = 1; // side_a 
    const encryptorKey = "test_encryptor_key_for_verification";

    // ---------- finalize_market ----------
    {
      const accountsFinalize = {
        authority: payer.publicKey, 
        marketKey: marketKey.publicKey,
        marketData: marketDataPda,
      };

      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 300_000,
        })
      );

      const ix = await program.methods
        .finalizeMarket(
          totalTicketsSideA,
          totalTicketsSideB,
          totalAmountSideA,
          totalAmountSideB,
          winningSide,
          encryptorKey
        )
        .accounts(accountsFinalize)
        .instruction();

      tx.add(ix);

      const latestBlockhash = await program.provider.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = payer.publicKey;

      try {
        const simulateResult = await anchor.utils.rpc.simulateTransaction(
          program.provider.connection,
          tx
        );
        if (simulateResult.value && simulateResult.value.logs) {
          console.log("FinalizeMarket logs:", simulateResult.value.logs);
        }
      } catch (simError: any) {
        console.error("Simulation failed (finalize_market):", simError);
        if (simError.logs) {
          console.log("Simulation logs:", simError.logs);
        } else if (simError.error && simError.error.logs) {
          console.log("Simulation logs:", simError.error.logs);
        } else {
          console.log("No simulation logs available.");
        }
      }

      const result = await web3.sendAndConfirmTransaction(
        program.provider.connection,
        tx,
        [program.provider.wallet.payer]
      );

      console.log("Finalize market tx:", result);
    }

    const marketAfterFinalize = await program.account.marketData.fetch(marketDataPda);
    console.log("Market after finalize:", {
      isFinalized: marketAfterFinalize.isFinalized,
      isRevealed: marketAfterFinalize.isRevealed,
      winningSide: marketAfterFinalize.winningSide,
      encryptor: marketAfterFinalize.encryptor,
      totalTicketsSideA: marketAfterFinalize.totalTicketsSideA.toString(),
      totalAmountSideA: marketAfterFinalize.totalAmountSideA.toString(),
    });

    // ---------- claim_reward ----------
    {

      const claimAmount = marketAfterFinalize.totalAmount as BN;

      const accountsClaim = {
        authority: payer.publicKey, // 
        user: payer.publicKey,      // 
        marketKey: marketKey.publicKey,
        marketData: marketDataPda,
        treasuryAccount: treasuryPda,
        userTickets: userTicketsPda,
        projectTreasury: PROJECT_TREASURY,
        systemProgram: web3.SystemProgram.programId,
      };

      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 300_000,
        })
      );

      const ix = await program.methods
        .claimReward(claimAmount)
        .accounts(accountsClaim)
        .instruction();

      tx.add(ix);

      const latestBlockhash = await program.provider.connection.getLatestBlockhash();
      tx.recentBlockhash = latestBlockhash.blockhash;
      tx.feePayer = payer.publicKey;

      try {
        const simulateResult = await anchor.utils.rpc.simulateTransaction(
          program.provider.connection,
          tx
        );
        if (simulateResult.value && simulateResult.value.logs) {
          console.log("ClaimReward logs:", simulateResult.value.logs);
        }
      } catch (simError: any) {
        console.error("Simulation failed (claim_reward):", simError);
        if (simError.logs) {
          console.log("Simulation logs:", simError.logs);
        } else if (simError.error && simError.error.logs) {
          console.log("Simulation logs:", simError.error.logs);
        } else {
          console.log("No simulation logs available.");
        }
      }

      const result = await web3.sendAndConfirmTransaction(
        program.provider.connection,
        tx,
        [program.provider.wallet.payer]
      );

      console.log("Claim reward tx:", result);
    }

    const userTicketsAfter = await program.account.userTickets.fetch(userTicketsPda);
    console.log("UserTickets after claim:", {
      hasClaimed: userTicketsAfter.hasClaimed,
    });

    const treasuryBalance = await program.provider.connection.getBalance(treasuryPda);
    console.log("Treasury lamports after claim:", treasuryBalance);
  });
});
