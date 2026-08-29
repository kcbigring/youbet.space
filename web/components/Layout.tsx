import Link from "next/link";
import { useRouter } from "next/router";
import type { ReactNode } from "react";
import { Logo } from "./Logo";

const TABS = [
  { href: "/", glyph: "◎", label: "Home" },
  { href: "/create", glyph: "＋", label: "Create" },
  { href: "/groups", glyph: "◍", label: "Groups" },
  { href: "/wallet", glyph: "◈", label: "Wallet" },
];

export function Layout({ children, title }: { children: ReactNode; title?: string }) {
  const router = useRouter();

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" aria-label="youbet.space home">
          <Logo size={20} />
        </Link>
        {title && <span className="small muted">{title}</span>}
      </header>

      {children}

      <nav className="tabbar">
        {TABS.map((tab) => {
          const active = tab.href === "/" ? router.pathname === "/" : router.pathname.startsWith(tab.href);
          return (
            <Link key={tab.href} href={tab.href} className={active ? "active" : ""}>
              <span className="glyph">{tab.glyph}</span>
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function Banner({ kind = "error", children }: { kind?: "error" | "info"; children: ReactNode }) {
  if (!children) return null;
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Avatar({ name }: { name?: string | null }) {
  const initials = (name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return <div className="avatar">{initials}</div>;
}
