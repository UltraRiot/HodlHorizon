// Shared by the toggle in components/Header.js and the pre-hydration
// flash-prevention script in pages/_document.js - both need to agree on
// the same localStorage key and fallback order (stored choice -> system
// preference -> dark, today's default experience). _document.js's script
// runs before any bundle loads, so it can't import this file - it keeps
// its own literal copy of the same logic instead. If THEME_STORAGE_KEY
// ever changes, that copy needs updating too.
export const THEME_STORAGE_KEY = "hodlhorizon-theme";

export function getPreferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage can throw in a private window with storage blocked -
    // fall through to the system-preference/dark default below.
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

// Sets data-theme on <html> and keeps the mobile browser chrome (address
// bar tint) in sync with it - the meta tag update is a nice-to-have, not
// required for the toggle itself to work.
export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f6f7fa" : "#0b1220");
}

export function setStoredTheme(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Same as above - persistence is a nice-to-have, never fatal.
  }
}
