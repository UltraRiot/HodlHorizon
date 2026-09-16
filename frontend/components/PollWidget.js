import { useState } from "react";
import { apiPost } from "../lib/api";

export default function PollWidget({ poll: initialPoll }) {
  const [poll, setPoll] = useState(initialPoll);
  const [voted, setVoted] = useState(false);

  if (!poll) return null;

  async function vote(optionId) {
    if (voted) return;
    try {
      const updated = await apiPost(`/api/polls/${poll.id}/vote`, { optionId });
      setPoll(updated);
      setVoted(true);
    } catch (err) {
      console.error("Vote failed", err);
    }
  }

  return (
    <div className="card">
      <h3 className="serif" style={{ margin: "0 0 14px", fontSize: 13, textTransform: "uppercase", letterSpacing: 1.3, color: "var(--text-mute)", fontWeight: 600 }}>
        Today's Poll
      </h3>
      <p style={{ margin: "0 0 16px", fontSize: 14.5, lineHeight: 1.45 }}>{poll.question}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {poll.options.map((option) => (
          <button
            key={option.id}
            onClick={() => vote(option.id)}
            disabled={voted}
            style={{
              all: "unset",
              cursor: voted ? "default" : "pointer",
              display: "block",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--text-dim)", marginBottom: 5 }}>
              <span>{option.label}</span>
              <span>{option.percent}%</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: "var(--border-soft)" }}>
              <div
                style={{
                  width: `${option.percent}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: "var(--gold-fill)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </button>
        ))}
      </div>
      <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--text-mute)" }}>
        {poll.total_votes.toLocaleString("en-US")} votes{voted ? " · thanks for voting!" : ""}
      </p>
    </div>
  );
}
