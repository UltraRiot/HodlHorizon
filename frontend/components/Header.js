import { useEffect, useState } from "react";
import Link from "next/link";
import { applyTheme, setStoredTheme } from "../lib/theme";

const NAV_ITEMS = [
  { href: "/", label: "Home" },
  { href: "/category/stocks", label: "Stocks" },
  { href: "/category/indices", label: "Indices" },
  { href: "/category/commodities", label: "Commodities" },
  { href: "/category/crypto", label: "Crypto" },
];

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(null);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") || "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    setStoredTheme(next);
  }

  return (
    <header
      className="site-header"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 48px",
        borderBottom: "1px solid var(--header-border)",
        position: "sticky",
        top: 0,
        background: "var(--header-bg)",
        backdropFilter: "blur(10px)",
        zIndex: 10,
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 36, flexWrap: "wrap" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <img src="/favicon.svg" width={38} height={38} alt="" style={{ borderRadius: 8 }} />
          <span className="serif" style={{ fontWeight: 600, fontSize: 22, color: "var(--text)" }}>
            Hodl<span style={{ color: "var(--gold)" }}>Horizon</span>
          </span>
        </Link>
        <nav className={`nav-links${menuOpen ? " open" : ""}`} style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              style={{ fontSize: 14, fontWeight: 500, color: "var(--text-dim)" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {theme ? (
          <button
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-dim)",
              flexShrink: 0,
            }}
          >
            {theme === "light" ? <MoonIcon /> : <SunIcon />}
          </button>
        ) : (
          <span style={{ width: 34, height: 34, flexShrink: 0 }} />
        )}

        <button
          className="nav-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? "✕" : "☰"}
        </button>
      </div>
    </header>
  );
}

function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="1.6" />
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <path d="M12 2.5V5" />
        <path d="M12 19V21.5" />
        <path d="M4.2 4.2L6 6" />
        <path d="M18 18L19.8 19.8" />
        <path d="M2.5 12H5" />
        <path d="M19 12H21.5" />
        <path d="M4.2 19.8L6 18" />
        <path d="M18 6L19.8 4.2" />
      </g>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
