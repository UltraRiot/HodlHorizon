import { useState } from "react";
import { apiPost } from "../lib/api";

// Anonymous "how do you read this story" reactions - no accounts needed.
// We only stop a user voting twice per browser tab (localStorage flag);
// there is no server-side protection against someone voting repeatedly.
export default function ReactionButtons({ articleId, initialCounts }) {
  const [counts, setCounts] = useState(initialCounts);
  const storageKey = `hodlhorizon_reacted_${articleId}`;
  const [reacted, setReacted] = useState(
    typeof window !== "undefined" && Boolean(localStorage.getItem(storageKey))
  );

  async function react(type) {
    if (reacted) return;
    try {
      const updated = await apiPost(`/api/articles/${articleId}/react`, { type });
      setCounts(updated);
      setReacted(true);
      localStorage.setItem(storageKey, type);
    } catch (err) {
      console.error("Reaction failed", err);
    }
  }

  const options = [
    { type: "bullish", label: "Bullish", count: counts.bullish_count, color: "var(--green)" },
    { type: "bearish", label: "Bearish", count: counts.bearish_count, color: "var(--red)" },
    { type: "neutral", label: "Neutral", count: counts.neutral_count, color: "var(--text-mute)" },
  ];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={o.type}
          onClick={() => react(o.type)}
          disabled={reacted}
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 13,
            color: o.color,
            fontWeight: 600,
            opacity: reacted ? 0.7 : 1,
            cursor: reacted ? "default" : "pointer",
          }}
        >
          {o.label} · {o.count}
        </button>
      ))}
    </div>
  );
}
