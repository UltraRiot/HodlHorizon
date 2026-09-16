# Hodl Horizon

A crypto and finance news site: an Express + PostgreSQL backend, a Next.js
frontend, and an AI engine that scans RSS sources and writes short,
factual news summaries automatically.

The code is written to be simple to read: plain JavaScript (no
TypeScript), plain SQL (no ORM), one small file per feature. Every file
has a short comment at the top explaining what it does.

## How it's organized

```
hodlhorizon/
  backend/     Express API + PostgreSQL + the AI engine
  frontend/    Next.js website (public site + admin panel)
```

The two run as separate processes and talk to each other over HTTP -
that's the "separated backend and frontend" you asked for. In production
you'd deploy them as two services (e.g. two apps on Render/Railway, or a
VM running both with a process manager).

## Requirements

- Node.js 18 or newer
- PostgreSQL (14+)

## 1. Set up the database

```
createuser hodlhorizon --pwprompt      # set the password to "hodlhorizon", or your own
createdb hodlhorizon --owner hodlhorizon
```

## 2. Set up the backend

```
cd backend
cp .env.example .env       # then open .env and check the values
npm install
npm run migrate            # creates all tables
npm run seed                # creates categories, sample sources, your admin login, a sample poll
npm run dev                  # starts the API on http://localhost:4000
```

Your admin login is whatever you set `ADMIN_EMAIL` / `ADMIN_PASSWORD` to
in `.env` before running `npm run seed` (defaults to
`admin@hodlhorizon.com` / `change-this-password` - change this).

## 3. Set up the frontend

In a second terminal:

```
cd frontend
cp .env.example .env.local
npm install
npm run dev                  # starts the site on http://localhost:3000
```

Visit `http://localhost:3000` for the public site and
`http://localhost:3000/admin/login` for the admin panel.

## 4. Turn on real AI writing (optional but recommended)

Out of the box, `AI_PROVIDER=mock` in `backend/.env` - the pipeline runs
end to end for free, but writes clearly-labelled placeholder articles
instead of real ones. To get real writing:

1. Get an API key from OpenAI or Anthropic.
2. In `backend/.env`, set `AI_PROVIDER=openai` (or `anthropic`) and paste
   your key into `OPENAI_API_KEY` (or `ANTHROPIC_API_KEY`).
3. Restart the backend.

The voice/tone every article is written in ("professional financial
journalist, human, not robotic") lives in one file:
`backend/src/services/ai/prompts.js` - edit that paragraph any time you
want to adjust the style.

## 5. Trigger your first scan

The AI engine runs automatically every `SCAN_INTERVAL_MINUTES` (default
15), or you can trigger it immediately from **Admin → AI Engine → "Scan
sources now"**.

It works like this: it fetches every active RSS feed (manage these under
**Admin → Feeds**), groups headlines that look like the same story, and
writes one article per story. If **2 or more independent sources**
report the same story, it's published immediately; if only one source
has it (and it passes the automated checks), it's saved as "Scheduled"
instead and auto-publishes on its own after `auto_publish_delay_hours`
(default 5h) - check **Admin → Articles** during that window if you want
to hold, edit, or delete it first. Anything that trips a check (a
category mismatch, an implausible price, a failed AI self-review) goes
to plain "In Review" instead, with no timer, and needs a human to
publish it. Change the "2 or more" threshold with
`AUTO_PUBLISH_MIN_SOURCES` in `backend/.env`, and turn auto-publish off
entirely from **Admin → AI Engine**.

The moment a story is saved as "Scheduled," `services/notifications/mailer.js`
sends an email to `ADMIN_ALERT_EMAIL` with the title, category, the single
source it was built from, a link straight to it in the admin panel, and the
exact time it auto-publishes - so that review window is something you'll
actually notice, not a silent timer. It needs `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `ADMIN_ALERT_EMAIL` in `backend/.env` (see
`backend/.env.example`); a Gmail account with an
[app password](https://myaccount.google.com/apppasswords) is the simplest
zero-new-signup option (`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`), though
the mailer is provider-agnostic - any SMTP relay (SendGrid, Mailgun,
Postmark, AWS SES, ...) works by changing just those four values. Leave
`ADMIN_ALERT_EMAIL` blank to disable this entirely - it's logged once, not
an error, and nothing else about scheduling or auto-publishing depends on
the email actually sending.

## What's real vs. what's a starting point

Being upfront about this so nothing surprises you later:

- **Crypto prices, movers, and the Market Snapshot (trend/RSI/support/
  resistance)** are fully real, computed from CoinGecko's free public
  API - no key needed.
- **Stocks/indices/commodities prices are real, never sample data** - each
  asset class is fetched on a schedule (never live per page load) from
  whichever provider actually covers it, and is simply omitted (not
  padded with a placeholder) if that provider's key is missing or a fetch
  fails:
  - SPY/QQQ (S&P 500 / Nasdaq 100 ETF proxies) - Twelve Data, needs
    `TWELVEDATA_API_KEY`, refreshed hourly.
  - Gold (via the GLD ETF proxy) and WTI crude - Alpha Vantage, needs
    `STOCKS_DATA_API_KEY`, quotes refreshed every 8h and history once a day.
  - The Markets Overview strip's other columns (indices/forex/commodities/
    stocks) also use `STOCKS_DATA_API_KEY` - see
    `backend/src/services/marketData/overviewCache.js`.
  See `backend/.env.example` for the exact budget math on both keys.
  Set `MARKET_DATA_DRY_RUN=true` in your local `.env` during development
  so testing the market-data pipeline never spends the production site's
  real daily quota - it's the default in `backend/.env.example`, so a
  fresh local checkout is dry-run out of the box.
  On top of that, use your own separate `STOCKS_DATA_API_KEY` locally - a
  second, free Alpha Vantage account/key, distinct from whatever key
  production uses - rather than pointing your local `.env` at the live
  site's key. `STOCKS_DATA_API_KEY` is the one variable name the code
  actually reads for Alpha Vantage everywhere (the Overview strip, the
  scheduled Gold/WTI job); there is no separate `ALPHAVANTAGE_API_KEY` in
  code, so don't use that name for the local key either. With your own key
  in place, even a `MARKET_DATA_DRY_RUN` slip on your machine burns a
  throwaway key's 25/day quota instead of the live site's.
- **The economic calendar** is a simple table you (or the admin panel)
  add events to by hand. Free calendar APIs with real-time economic
  events are rare - a paid one (e.g. Trading Economics) could feed this
  table automatically later.
- **RSS sources** ship with three examples (CoinDesk, CoinTelegraph,
  Investing.com). Add, disable, or remove sources anytime from
  **Admin → Feeds** - no code changes needed.
- **The "2+ sources agree" duplicate-detection** compares headline word
  overlap. It's simple on purpose (so you can read and tune it in
  `backend/src/services/rss/grouping.js`) rather than a black-box ML
  model.

## Everything from our conversation, and where it lives

- **English site, no user accounts, no comments** — done throughout.
- **Feeds/likes/polls/AI articles stored in PostgreSQL** — see
  `backend/src/migrations/001_init.sql`.
- **Admin panel to manage feeds and the AI** — `/admin` (Feeds, Articles,
  AI Engine, SEO, Calendar, Glossary).
- **No images in articles** — the article template never renders one.
- **Price/technical analysis for traders** — the homepage's Market
  Snapshot widget and the "Analysis" category.
- **Human-but-professional AI tone** — `backend/src/services/ai/
  prompts.js`.
- **OpenAI credit usable here** — yes; see step 4 above. The provider
  layer (`backend/src/services/ai/`) is written so OpenAI and Anthropic
  are interchangeable by one `.env` line, and every call is logged to
  the database so **Admin → AI Engine** shows a running cost estimate.
- **Richer-than-CryptoPanic feed cards, full article on click, sources
  cited** — the homepage feed and article page.
- **Learn/glossary section (SEO long-tail content)** — `/learn`,
  managed from **Admin → Glossary**.
- **Sitemap, robots.txt, JSON-LD structured data, per-article SEO
  title/description** — `frontend/pages/sitemap.xml.js`,
  `frontend/public/robots.txt`, and the `<script type="application/
  ld+json">` block on every article page.
- **Fact-check-ish editorial rule** (2+ sources publish immediately;
  1 source publishes after a timed review window instead of instantly) —
  `backend/src/services/rss/scanAndGenerate.js`.
- **AI cost tracker** — **Admin → AI Engine**, backed by
  `ai_usage_log`.
- **Privacy-friendly, cookieless analytics** — set
  `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` in `frontend/.env.local`; leave it
  blank and nothing loads.
- **Affiliate disclosure, Privacy, Terms, About/Contact pages** —
  `/disclosure`, `/privacy`, `/terms`, `/about`, `/contact`.
- **Bullish/bearish/neutral reactions on articles** — replaces a plain
  "like" button with something more useful for a trading audience.
- **Crypto top movers widget** — homepage sidebar.
- **Economic calendar widget** — homepage sidebar, managed from
  **Admin → Calendar**.

## Before this goes live

A few things worth doing that are outside what code can do for you:

- Have a lawyer (or at least a template service aimed at your
  jurisdiction) review the Privacy Policy and Terms pages - the ones
  shipped here are clearly-marked drafts, not legal advice.
- Pick a real hosting setup for two services + a database (e.g. a small
  VM, or Railway/Render for both apps plus a managed Postgres).
- Set a strong, unique `JWT_SECRET` and admin password in production -
  don't reuse the example values.
- If you ever add display ads (which usually set their own cookies),
  update the Privacy Policy and add a cookie consent banner at that
  point - not needed yet, since nothing here sets tracking cookies.
