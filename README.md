# Hodl Horizon

Crypto and markets news site. It scans RSS feeds, groups related
headlines into stories, writes short news briefs, and publishes daily
technical analysis built from live market data.

- **backend/**: Express API, PostgreSQL, scheduled jobs (feed scanning,
  analysis, market-data refresh, maintenance)
- **frontend/**: Next.js public site and admin panel

Plain JavaScript and plain SQL, with no TypeScript and no ORM.

## Requirements

- Node.js 18+
- PostgreSQL 14+

## Getting started

### Database

```
createuser hodlhorizon --pwprompt
createdb hodlhorizon --owner hodlhorizon
```

### Backend

```
cd backend
cp .env.example .env
npm install
npm run migrate
npm run seed
npm run dev        # http://localhost:4000
```

`npm run seed` creates the categories, the default RSS sources, a sample
poll, and an admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### Frontend

```
cd frontend
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000
```

The admin panel is at `/admin/login`.

### Tests

```
cd backend
npm test
```

## Configuration

All backend settings live in `backend/.env`. `backend/.env.example`
documents each variable. The main groups are:

| Area | Variables |
| --- | --- |
| Database / server | `DATABASE_URL`, `PORT`, `FRONTEND_URL` |
| Admin auth | `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET` |
| Content generation | `AI_PROVIDER` (`mock` by default, needs no key), plus the matching API key and model |
| Scheduling | `SCAN_INTERVAL_MINUTES`, `AUTO_PUBLISH_MIN_SOURCES`, `ANALYSIS_INTERVAL_HOURS` |
| Market data | `TWELVEDATA_API_KEY`, `STOCKS_DATA_API_KEY`, `COINGECKO_API_KEY` (optional), `MARKET_DATA_DRY_RUN` |
| Alert emails | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ADMIN_ALERT_EMAIL` |

Frontend settings (`frontend/.env.local`): `NEXT_PUBLIC_API_URL`,
`NEXT_PUBLIC_SITE_URL`, and `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` (optional
analytics).

`MARKET_DATA_DRY_RUN=true` is the default in development, so local runs
don't use up real API quota.

## How publishing works

1. Every `SCAN_INTERVAL_MINUTES`, the scanner fetches all active feeds.
   You manage feeds under **Admin → Feeds**, and each feed belongs to
   exactly one category.
2. Headlines about the same event are grouped into a single story
   (`backend/src/services/rss/grouping.js`).
3. The scanner writes a brief for each new story and checks it for
   category mismatches, implausible prices, stale content, and redundancy.
4. Each brief then gets one of three statuses:
   - **Published** right away if `AUTO_PUBLISH_MIN_SOURCES` or more
     independent sources report the story and every check passes.
   - **Scheduled** if only one source reports it and every check passes.
     It auto-publishes after the review window (default 5h), and an alert
     email goes to `ADMIN_ALERT_EMAIL`.
   - **In Review** if any check fails. It waits for manual approval in
     **Admin → Articles**.

The Analysis job runs separately every `ANALYSIS_INTERVAL_HOURS`. It
writes analysis from computed trend, RSI, and support/resistance values,
and only when an asset has actually moved.

## Market data

- **Crypto:** CoinGecko (works without a key; a free Demo key raises the
  rate limit)
- **Indices, gold, forex, stocks:** Twelve Data
- **WTI, Brent, natural gas:** Alpha Vantage

Data is refreshed on a schedule, not on each page load. If a provider key
is missing or a request fails, that instrument is hidden rather than shown
with placeholder data.

## Admin panel

| Page | Purpose |
| --- | --- |
| Articles | Review, edit, schedule, publish, or delete articles |
| Feeds | Add, disable, or remove RSS sources |
| Engine | Run a scan manually, set daily caps, toggle auto-publish, see usage and costs |
| SEO | Per-article titles/descriptions and evergreen refreshes |
| Calendar | Economic calendar events |
| Glossary | Entries for the `/learn` section |
| Polls | Homepage polls |

## Project layout

```
backend/src/
  routes/          public and admin API routes
  services/        rss, analysis, marketData, seo, audit, notifications, ...
  jobs/            scheduler
  migrations/      numbered SQL migrations (npm run migrate)
frontend/
  pages/           public pages, /learn, /article, /admin
  components/      shared UI
  lib/             API client and helpers
```

## Deployment checklist

- Set a strong `JWT_SECRET` and admin password.
- Set `MARKET_DATA_DRY_RUN=false` and provide real market-data keys.
- Set `NEXT_PUBLIC_SITE_URL` to the production domain.
- Have the Privacy Policy and Terms pages reviewed for your jurisdiction.
- If you add ads or anything else that sets cookies, update the Privacy
  Policy and add a consent banner.
