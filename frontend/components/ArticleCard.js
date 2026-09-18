import Link from "next/link";

export default function ArticleCard({ article }) {
  return (
    <article
      style={{
        padding: "24px 2px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className={`chip chip-${article.category_slug}`}>{article.category_name}</span>
        <span style={{ color: "var(--text-mute)", fontSize: 13 }}>{article.time_ago}</span>
      </div>

      <Link href={`/article/${article.slug}`}>
        <h2 className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.32, margin: 0, color: "var(--text)" }}>
          {article.title}
        </h2>
      </Link>

      <p style={{ margin: 0, color: "var(--text-dim)", fontSize: 15, lineHeight: 1.55, maxWidth: 660 }}>{article.dek}</p>

      <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 2, color: "var(--text-mute)", fontSize: 12.5 }}>
        <span>{article.read_minutes} min read</span>
        <span>{article.source_count} source{article.source_count === 1 ? "" : "s"}</span>
      </div>
    </article>
  );
}
