import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

const STATUS_STYLE = {
  active: { background: "rgba(63,197,132,0.14)", color: "var(--green)" },
  archived: { background: "rgba(122,138,168,0.16)", color: "var(--text-dim)" },
};

const EMPTY_OPTIONS = ["", ""];

export default function AdminPolls() {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);

  const [widgetEnabled, setWidgetEnabled] = useState(null); // null = not loaded yet

  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      adminFetch("/api/admin/polls"),
      adminFetch("/api/admin/settings/poll-widget"),
    ])
      .then(([pollsResult, widgetResult]) => {
        setPolls(pollsResult);
        setWidgetEnabled(widgetResult.poll_widget_enabled);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleWidget() {
    const next = !widgetEnabled;
    setWidgetEnabled(next); // optimistic, matches the ai-engine.js toggle pattern
    await adminFetch("/api/admin/settings/poll-widget", {
      method: "PATCH",
      body: JSON.stringify({ poll_widget_enabled: next }),
    });
  }

  function updateOption(index, value) {
    setOptions((current) => current.map((o, i) => (i === index ? value : o)));
  }

  function addOption() {
    setOptions((current) => (current.length < 6 ? [...current, ""] : current));
  }

  function removeOption(index) {
    setOptions((current) => (current.length > 2 ? current.filter((_, i) => i !== index) : current));
  }

  async function createPoll(e) {
    e.preventDefault();
    setCreating(true);
    try {
      await adminFetch("/api/admin/polls", {
        method: "POST",
        body: JSON.stringify({ question, options: options.map((o) => o.trim()).filter(Boolean) }),
      });
      setQuestion("");
      setOptions(EMPTY_OPTIONS);
      load();
    } finally {
      setCreating(false);
    }
  }

  async function archive(id) {
    await adminFetch(`/api/admin/polls/${id}/archive`, { method: "PATCH" });
    load();
  }

  async function restore(id) {
    await adminFetch(`/api/admin/polls/${id}/restore`, { method: "PATCH" });
    load();
  }

  async function remove(id) {
    if (!window.confirm("Delete this poll permanently? This also removes its vote history and cannot be undone.")) {
      return;
    }
    await adminFetch(`/api/admin/polls/${id}`, { method: "DELETE" });
    load();
  }

  const validOptionCount = options.map((o) => o.trim()).filter(Boolean).length;
  const canSubmit = question.trim().length > 0 && validOptionCount >= 2;

  return (
    <AdminLayout title="Polls">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Widget</h3>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14 }}>Show poll widget on homepage</span>
            {widgetEnabled !== null && (
              <button
                onClick={toggleWidget}
                style={{
                  width: 44, height: 24, borderRadius: 12, border: "none", position: "relative",
                  background: widgetEnabled ? "var(--gold-fill)" : "var(--border)",
                }}
              >
                <span style={{ position: "absolute", top: 3, left: widgetEnabled ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#1a1508", transition: "left 0.15s" }} />
              </button>
            )}
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--text-mute)" }}>
            Off hides the poll widget everywhere it's shown, regardless of whether any poll below is active.
          </p>
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>New poll</h3>
          <form onSubmit={createPoll} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              placeholder="Question, e.g. Do you think BTC breaks $120,000 this week?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              required
              style={inputStyle}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {options.map((option, i) => (
                <div key={i} style={{ display: "flex", gap: 8 }}>
                  <input
                    placeholder={`Option ${i + 1}`}
                    value={option}
                    onChange={(e) => updateOption(i, e.target.value)}
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  {options.length > 2 && (
                    <button type="button" onClick={() => removeOption(i)} style={{ ...smallButtonStyle, color: "var(--red)" }}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {options.length < 6 && (
                <button type="button" onClick={addOption} style={smallButtonStyle}>+ Add option</button>
              )}
              <span style={{ fontSize: 12, color: "var(--text-mute)" }}>{options.length}/6 options</span>
            </div>

            <div>
              <button type="submit" disabled={!canSubmit || creating} style={buttonStyle}>
                {creating ? "Creating…" : "Create poll"}
              </button>
            </div>
          </form>
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>All polls</h3>
          {loading ? (
            <p style={{ color: "var(--text-mute)" }}>Loading…</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {polls.map((poll) => (
                <div key={poll.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                        <span style={{ ...STATUS_STYLE[poll.status], padding: "3px 9px", borderRadius: 5, fontSize: 11.5, fontWeight: 600 }}>
                          {poll.status}
                        </span>
                        <span style={{ fontSize: 12, color: "var(--text-mute)" }}>{poll.total_votes} vote{poll.total_votes === 1 ? "" : "s"}</span>
                      </div>
                      <p style={{ margin: 0, fontSize: 14.5 }}>{poll.question}</p>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {poll.status === "active" ? (
                        <button onClick={() => archive(poll.id)} style={smallButtonStyle}>Archive</button>
                      ) : (
                        <button onClick={() => restore(poll.id)} style={smallButtonStyle}>Restore</button>
                      )}
                      <button onClick={() => remove(poll.id)} style={{ ...smallButtonStyle, color: "var(--red)" }}>Delete</button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                    {poll.options.map((option) => (
                      <div key={option.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                        <span style={{ flex: 1, color: "var(--text-dim)" }}>{option.label}</span>
                        <div style={{ width: 120, height: 6, borderRadius: 3, background: "var(--bg-elevated)", overflow: "hidden" }}>
                          <div style={{ width: `${option.percent}%`, height: "100%", background: "var(--gold-fill)" }} />
                        </div>
                        <span style={{ width: 90, textAlign: "right", color: "var(--text-mute)" }}>
                          {option.votes} ({option.percent}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {polls.length === 0 && <p style={{ color: "var(--text-mute)" }}>No polls yet.</p>}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}

const inputStyle = { padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontSize: 13, fontFamily: "inherit" };
const buttonStyle = { padding: "9px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13 };
const smallButtonStyle = { padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 };
