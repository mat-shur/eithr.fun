"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletNavButton from "./WalletNavButton";

const navLinks = [
  { href: "/", label: "About" },
  { href: "/markets", label: "Markets" },
  { href: "/create", label: "Create" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <div className="flex items-center justify-between text-[11px] tracking-[0.32em] uppercase text-zinc-500">
      {/* left logo */}
      <Link
        href="/"
        className="hover:text-zinc-900 transition-colors duration-300"
      >
        eithr.fun
      </Link>

      {/* center nav */}
      <div className="hidden md:flex items-center gap-10">
        {navLinks.map((link) => {
          const isActive =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`pb-1 border-b transition-colors duration-300 leaging-relaxed hover:text-zinc-900 ${
                isActive ? "border-zinc-900 text-white-900" : "border-transparent"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      {/* right wallet button */}
      <WalletNavButton />
    </div>
  );
}
