import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { isAdminLoggedIn, clearAdminToken } from "../lib/api";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/feeds", label: "Feeds" },
  { href: "/admin/articles", label: "Articles" },
  { href: "/admin/ai-engine", label: "AI Engine" },
  { href: "/admin/seo", label: "SEO" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/glossary", label: "Glossary" },
  { href: "/admin/polls", label: "Polls" },
];

// Wraps every admin page: checks you're logged in (client-side only - the
// real protection is the backend's JWT check on every API call) and renders
// the sidebar from the approved design.
export default function AdminLayout({ title, children }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!isAdminLoggedIn()) {
      router.replace("/admin/login");
    } else {
      setChecked(true);
    }
  }, [router]);

  if (!checked) return null;

  return (
    <div className="admin-shell" style={{ display: "flex", minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <div className="admin-sidebar" style={{ width: 230, flexShrink: 0, background: "var(--bg-elevated)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", padding: "22px 0" }}>
        <div className="admin-logo-row" style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 24px", marginBottom: 30 }}>
          <span className="serif" style={{ fontWeight: 600, fontSize: 18 }}>
            Hodl<span style={{ color: "var(--gold)" }}>Horizon</span>
          </span>
        </div>

        <button
          className="admin-nav-toggle"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? "✕" : "☰"}
        </button>

        {/* Grouped so the mobile dropdown (position:absolute, hidden unless
            "open") can hide/show label+nav+logout together as one unit -
            flex:1 here keeps the logout button's marginTop:"auto" pinning
            to the bottom of the sidebar on desktop, exactly as before. */}
        <div className={`admin-nav-group${menuOpen ? " open" : ""}`}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-mute)", padding: "0 24px", marginBottom: 8 }}>
            Admin
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV.map((item) => {
              const active = router.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    padding: "11px 20px",
                    margin: "0 12px",
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: active ? 600 : 500,
                    background: active ? "var(--bg-card)" : "transparent",
                    color: active ? "var(--gold)" : "var(--text-dim)",
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div style={{ marginTop: "auto", padding: "18px 24px 0" }}>
            <button
              onClick={() => {
                clearAdminToken();
                router.push("/admin/login");
              }}
              style={{ background: "none", border: "none", color: "var(--text-mute)", fontSize: 13 }}
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      <div className="admin-content" style={{ flex: 1, minWidth: 0, padding: "30px 40px" }}>
        <h1 className="serif" style={{ margin: "0 0 26px", fontSize: 24, fontWeight: 600 }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}
