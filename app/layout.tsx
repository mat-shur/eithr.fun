import type { Metadata } from "next";
import "./globals.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import Navbar from "./_components/Navbar";
import AppWalletProvider from "./_components/AppWalletProvider";

export const metadata: Metadata = {
  title: "eithr.fun — playful prediction markets",
  description: "Create fun two-sided prediction markets on Solana.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-black text-zinc-50 antialiased">
        <AppWalletProvider>
          <div className="min-h-screen flex flex-col">
            {/* Top bar */}
            <header className="px-6 md:px-10 lg:px-16 pt-6">
              <Navbar />
            </header>

            {/* Page content */}
            <main className="flex-1 px-6 md:px-10 lg:px-16 pb-12">
              {children}
            </main>
          </div>
        </AppWalletProvider>
      </body>
    </html>
  );
}
