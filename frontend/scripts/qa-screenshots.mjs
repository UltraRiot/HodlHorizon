import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(SCRIPT_DIR, "..", "qa-screenshots") + path.sep;
const THEME_STORAGE_KEY = "hodlhorizon-theme";
const ADMIN_TOKEN_KEY = "hodlhorizon_admin_token";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function isServerUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isServerUp(url)) return true;
    await sleep(1000);
  }
  return false;
}

async function findRealSlug(apiPath) {
  try {
    const res = await fetch(`${API_URL}${apiPath}`, { signal: AbortSignal.timeout(5000) });
    const rows = await res.json();
    return rows[0]?.slug || null;
  } catch {
    return null;
  }
}

async function getAdminToken() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return null;
  try {
    const res = await fetch(`${API_URL}/api/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.token || null;
  } catch {
    return null;
  }
}

async function screenshotPage(browser, { name, path: urlPath, theme, viewportName, adminToken }) {
  const context = await browser.newContext({ viewport: VIEWPORTS[viewportName] });
  await context.addInitScript(
    ({ themeKey, themeValue, adminKey, adminValue }) => {
      localStorage.setItem(themeKey, themeValue);
      if (adminValue) localStorage.setItem(adminKey, adminValue);
    },
    { themeKey: THEME_STORAGE_KEY, themeValue: theme, adminKey: ADMIN_TOKEN_KEY, adminValue: adminToken }
  );
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().startsWith(BASE_URL)) {
      consoleErrors.push(`HTTP ${res.status()} loading ${res.url()}`);
    }
  });

  await page.goto(`${BASE_URL}${urlPath}`, { waitUntil: "networkidle", timeout: 30000 });
  const actualTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const filePath = `${OUT_DIR}${name}-${theme}-${viewportName}.png`;
  await page.screenshot({ path: filePath, fullPage: true });
  await context.close();

  return { name, theme, viewportName, path: urlPath, actualTheme, filePath, consoleErrors };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let startedServer = null;
  if (!(await isServerUp(BASE_URL))) {
    console.log(`No server at ${BASE_URL} - starting "npm run dev"...`);
    startedServer = spawn("npm", ["run", "dev"], {
      cwd: path.join(SCRIPT_DIR, ".."),
      shell: true,
      stdio: "ignore",
    });
    const up = await waitForServer(BASE_URL);
    if (!up) {
      startedServer.kill();
      throw new Error(`Server at ${BASE_URL} did not become ready within the timeout.`);
    }
    console.log("Server ready.");
  } else {
    console.log(`Reusing already-running server at ${BASE_URL}.`);
  }

  const articleSlug = await findRealSlug("/api/articles?limit=1");
  if (!articleSlug) console.warn(`Could not fetch a real article slug from ${API_URL} - article-page screenshots will be skipped.`);
  const glossarySlug = await findRealSlug("/api/glossary");
  if (!glossarySlug) console.warn(`Could not fetch a real glossary slug from ${API_URL} - /learn/[slug] screenshots will be skipped.`);
  const adminToken = await getAdminToken();
  if (!adminToken) console.warn("No admin token (set ADMIN_EMAIL/ADMIN_PASSWORD to include an authenticated admin page) - admin-dashboard screenshots will be skipped.");

  const targets = [
    { name: "homepage", path: "/" },
    { name: "category-crypto", path: "/category/crypto" },
    ...(articleSlug ? [{ name: "article", path: `/article/${articleSlug}` }] : []),
    { name: "learn-index", path: "/learn" },
    ...(glossarySlug ? [{ name: "learn-entry", path: `/learn/${glossarySlug}` }] : []),
    { name: "terms", path: "/terms" },
    { name: "disclosure", path: "/disclosure" },
    { name: "admin-login", path: "/admin/login" },
    ...(adminToken ? [{ name: "admin-dashboard", path: "/admin", requiresAuth: true }] : []),
  ];

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const target of targets) {
      for (const theme of ["light", "dark"]) {
        for (const viewportName of ["desktop", "mobile"]) {
          console.log(`Screenshotting ${target.name} (${theme}, ${viewportName})...`);
          const result = await screenshotPage(browser, {
            ...target,
            theme,
            viewportName,
            adminToken: target.requiresAuth ? adminToken : null,
          });
          results.push(result);
        }
      }
    }
  } finally {
    await browser.close();
    if (startedServer) startedServer.kill();
  }

  console.log(`\n${results.length} screenshots saved to ${OUT_DIR}\n`);
  let anyMismatch = false;
  let anyConsoleErrors = false;
  for (const r of results) {
    const themeOk = r.actualTheme === r.theme;
    if (!themeOk) anyMismatch = true;
    if (r.consoleErrors.length) anyConsoleErrors = true;
    console.log(
      `${themeOk ? "OK  " : "MISMATCH"} ${r.name.padEnd(16)} ${r.viewportName.padEnd(8)} requested=${r.theme.padEnd(5)} actual=${String(r.actualTheme).padEnd(5)}${
        r.consoleErrors.length ? `  console/network errors: ${r.consoleErrors.length}` : ""
      }`
    );
    r.consoleErrors.forEach((e) => console.log(`    - ${e}`));
  }
  if (anyMismatch) {
    console.error("\nOne or more pages did not render the requested theme - the toggle/persistence mechanism may be broken.");
    process.exitCode = 1;
  }
  if (anyConsoleErrors) {
    console.error("\nOne or more pages logged a console/network error - see details above.");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
