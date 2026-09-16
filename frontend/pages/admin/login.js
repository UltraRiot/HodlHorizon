import { useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import { apiPost, setAdminToken } from "../../lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    try {
      const { token } = await apiPost("/api/admin/login", { email, password });
      setAdminToken(token);
      router.push("/admin");
    } catch (err) {
      setError("Invalid email or password.");
    }
  }

  return (
    <>
      <Head><title>Admin Login | Hodl Horizon</title></Head>
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <form onSubmit={handleSubmit} className="card" style={{ width: 340, display: "flex", flexDirection: "column", gap: 14 }}>
          <h1 className="serif" style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 600, color: "var(--text)" }}>
            Hodl<span style={{ color: "var(--gold)" }}>Horizon</span> Admin
          </h1>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          {error && <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{error}</p>}
          <button type="submit" style={{ padding: "10px 16px", borderRadius: 7, background: "var(--gold-fill)", color: "#1a1508", fontWeight: 600, border: "none", fontSize: 14 }}>
            Log in
          </button>
        </form>
      </div>
    </>
  );
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  color: "var(--text)",
  fontSize: 14,
};
