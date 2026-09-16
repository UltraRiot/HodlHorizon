import { useEffect, useState } from "react";
import AdminLayout from "../../components/AdminLayout";
import { adminFetch } from "../../lib/api";

export default function AiEngine() {
  const [settings, setSettings] = useState(null);
  const [usage, setUsage] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  function load() {
    adminFetch("/api/admin/ai-engine/settings").then(setSettings);
    adminFetch("/api/admin/usage").then(setUsage);
  }

  useEffect(load, []);

  async function toggleAutoPublish() {
    const next = !settings.auto_publish;
    setSettings({ ...settings, auto_publish: next });
    await adminFetch("/api/admin/ai-engine/settings", { method: "PATCH", body: JSON.stringify({ auto_publish: next }) });
  }

  async function changeInterval(minutes) {
    setSettings({ ...settings, scan_interval_minutes: minutes });
    await adminFetch("/api/admin/ai-engine/settings", { method: "PATCH", body: JSON.stringify({ scan_interval_minutes: minutes }) });
  }

  async function scanNow() {
    setScanning(true);
    try {
      const result = await adminFetch("/api/admin/ai-engine/scan-now", { method: "POST" });
      setLastResult(result);
      load();
    } finally {
      setScanning(false);
    }
  }

  if (!settings) return <AdminLayout title="AI Engine"><p style={{ color: "var(--text-mute)" }}>Loading…</p></AdminLayout>;

  return (
    <AdminLayout title="AI Engine">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Settings</h3>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14 }}>Auto-publish</span>
            <button
              onClick={toggleAutoPublish}
              style={{
                width: 44, height: 24, borderRadius: 12, border: "none", position: "relative",
                background: settings.auto_publish ? "var(--gold-fill)" : "var(--border)",
              }}
            >
              <span style={{ position: "absolute", top: 3, left: settings.auto_publish ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#1a1508", transition: "left 0.15s" }} />
            </button>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-mute)", marginBottom: 16 }}>
            Scan interval (minutes)
            <input
              type="number"
              min={1}
              value={settings.scan_interval_minutes}
              onChange={(e) => changeInterval(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-elevated)", color: "var(--text)", width: 100 }}
            />
          </label>
          <p style={{ fontSize: 13, color: "var(--text-mute)" }}>
            Current AI provider: <strong style={{ color: "var(--text)" }}>{settings.ai_provider}</strong>
            {settings.ai_provider === "mock" && " (set AI_PROVIDER in backend/.env to switch to real writing)"}
          </p>
          <button onClick={scanNow} disabled={scanning} style={{ padding: "9px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 13, marginTop: 8 }}>
            {scanning ? "Scanning…" : "Scan sources now"}
          </button>
          {lastResult && (
            <p style={{ fontSize: 12.5, color: "var(--text-mute)", marginTop: 10 }}>
              Scanned {lastResult.itemsScanned} items · {lastResult.newStories} new stories ·{" "}
              {lastResult.published} published · {lastResult.sentToReview} sent to review
            </p>
          )}
        </div>

        <div className="card">
          <h3 className="serif" style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600 }}>Cost This Month</h3>
          {usage ? (
            <>
              <div className="serif" style={{ fontSize: 26, fontWeight: 600, color: "var(--gold)", marginBottom: 14 }}>
                ${usage.total_cost_usd}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--text-dim)" }}>
                {usage.by_provider.map((p) => (
                  <div key={p.provider} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{p.provider} ({p.calls} calls)</span>
                    <span>${p.cost_usd}</span>
                  </div>
                ))}
                {usage.by_provider.length === 0 && <span style={{ color: "var(--text-mute)" }}>No AI calls yet.</span>}
              </div>
            </>
          ) : (
            <p style={{ color: "var(--text-mute)" }}>Loading…</p>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
