// Every fetch call to the backend goes through these two helpers, so
// there's exactly one place that knows the API's base URL and how admin
// auth headers work.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export async function apiGet(path) {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

// --- Admin (JWT-protected) ---

function adminToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("hodlhorizon_admin_token");
}

export function setAdminToken(token) {
  localStorage.setItem("hodlhorizon_admin_token", token);
}

export function clearAdminToken() {
  localStorage.removeItem("hodlhorizon_admin_token");
}

export function isAdminLoggedIn() {
  return Boolean(adminToken());
}

export async function adminFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${adminToken()}`,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    clearAdminToken();
    if (typeof window !== "undefined") window.location.href = "/admin/login";
    throw new Error("Not authenticated.");
  }

  if (!res.ok) throw new Error(`${options.method || "GET"} ${path} failed: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}
