"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";

const navItems = [
  { label: "Properties", href: "/properties" },
  { label: "Rent Comps", href: "/rent-comps" },
  { label: "Rent Roll", href: "/rent-roll" },
  { label: "T12", href: "/t12" },
  { label: "Trade-Out", href: "/trade-out" },
];

export default function NavBar() {
  const pathname = usePathname();

  return (
    <header className="bg-navy-950 border-b border-navy-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/properties" className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-gold-500 rounded flex items-center justify-center flex-shrink-0">
              <span className="text-navy-950 font-black text-sm">A</span>
            </div>
            <div>
              <span className="text-white font-bold text-base tracking-tight leading-none block">
                AREL CAPITAL
              </span>
              <span className="text-gold-400 text-xs font-medium tracking-widest uppercase leading-none">
                Underwriting Tools
              </span>
            </div>
          </Link>

          {/* Nav links */}
          <nav className="hidden sm:flex items-center gap-1">
            {navItems.map((item) => {
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    active
                      ? "bg-gold-500 text-navy-950"
                      : "text-gray-300 hover:text-white hover:bg-navy-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* User */}
          <div className="flex items-center gap-3">
            <UserButton
              appearance={{
                elements: {
                  avatarBox: "w-8 h-8",
                },
              }}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
