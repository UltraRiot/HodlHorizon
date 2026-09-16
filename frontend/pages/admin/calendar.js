import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

export default function AdminCalendar() {
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ title: "", event_time: "", impact: "medium", category: "macro" });

  function load() {
    adminFetch("/api/admin/calendar").then(setEvents);
  }

  useEffect(load, []);

  async function addEvent(e) {
    e.preventDefault();
    await adminFetch("/api/admin/calendar", { method: "POST", body: JSON.stringify(form) });
    setForm({ title: "", event_time: "", impact: "medium", category: "macro" });
    load();
  }

  async function remove(id) {
    await adminFetch(`/api/admin/calendar/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <AdminLayout title="Calendar">
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Add an event</h3>
          <form onSubmit={addEvent} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
            <input type="datetime-local" value={form.event_time} onChange={(e) => setForm({ ...form, event_time: e.target.value })} required style={inputStyle} />
            <select value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} style={inputStyle}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button type="submit" style={buttonStyle}>Add</button>
          </form>
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Upcoming</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {events.map((ev) => (
              <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ flex: 1, fontSize: 14 }}>{ev.title}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-mute)" }}>{new Date(ev.event_time).toLocaleString()}</span>
                <span style={{ fontSize: 12, color: "var(--text-mute)" }}>{ev.impact}</span>
                <button onClick={() => remove(ev.id)} style={{ ...smallButtonStyle, color: "var(--red)" }}>Delete</button>
              </div>
            ))}
            {events.length === 0 && <p style={{ color: "var(--text-mute)" }}>No events yet.</p>}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}

const inputStyle = { padding: "9px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", fontSize: 13 };
const buttonStyle = { padding: "9px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13 };
const smallButtonStyle = { padding: "6px 10px", borderRadius: 6, background: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 12 };
