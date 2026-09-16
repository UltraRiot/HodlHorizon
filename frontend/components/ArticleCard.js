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
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, color: "var(--text-mute)", fontSize: 11.5 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M12 3L14 9L20 11L14 13L12 19L10 13L4 11L10 9L12 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          AI Summary
        </span>
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
