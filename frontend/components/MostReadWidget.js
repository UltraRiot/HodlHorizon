import Link from "next/link";

export default function MostReadWidget({ articles }) {
  if (!articles || articles.length === 0) return null;

  return (
    <div className="card">
      <h3 className="serif" style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}>
        Most Read Today
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {articles.map((a, i) => (
          <Link key={a.id} href={`/article/${a.slug}`} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span className="serif" style={{ fontSize: 14, fontWeight: 700, color: "var(--gold)", width: 14, flexShrink: 0 }}>
              {i + 1}
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--text)" }}>{a.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
