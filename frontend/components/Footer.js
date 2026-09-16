import Link from "next/link";

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "28px 48px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: "var(--text-mute)",
        fontSize: 12.5,
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      <span>
        © {new Date().getFullYear()} Hodl Horizon · Articles are automatically summarized by AI from
        trusted financial sources. Not financial advice.
      </span>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Link href="/privacy" style={{ color: "var(--text-mute)" }}>Privacy</Link>
        <Link href="/terms" style={{ color: "var(--text-mute)" }}>Terms</Link>
        <Link href="/disclosure" style={{ color: "var(--text-mute)" }}>Disclosure</Link>
        <Link href="/about" style={{ color: "var(--text-mute)" }}>About</Link>
        <Link href="/contact" style={{ color: "var(--text-mute)" }}>Contact</Link>
      </div>
    </footer>
  );
}
