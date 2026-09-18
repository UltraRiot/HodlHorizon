// Wires the Economic Calendar to a real feed instead of admin-entered
// rows only. ForexFactory's own calendar widget runs on this exact URL -
// there's no official public API for it, so this is treated as
// inherently unstable: every fetch is try/catch'd, the response shape is
// validated before use, and any failure just leaves calendar_events
// exactly as it was (routes/calendar.js keeps serving whatever's already
// in the DB). Failures are logged clearly so a permanent disappearance of
// the feed gets noticed, not silently absorbed forever.
//
// Only the "thisweek" variant is fetched - "nextweek"/"lastweek"/
// "thismonth" were confirmed to 404 against this feed. Fetching
// "thisweek" once a day is enough: each new day's fetch naturally
// includes that day's newly-visible events as the week rolls forward.
import { query } from "../../db.js";

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_RUN_SETTING_KEY = "calendar_sync_last_run";

// country -> region mapping, done here (the sync job), not the frontend,
// per the task - and always computed fresh from the feed's raw currency
// code on every sync, never reverse-engineered from whatever's already
// sitting in the DB's region column (that information is genuinely lossy
// once collapsed to a continent bucket - "Asia" alone can't tell you
// whether a row was originally JPY or CNY). Labelled by financial center
// rather than continent - the originating city, matching how
// ForexFactory itself identifies these. Anything not listed here - CHF,
// "All" (used for multi-country entries like summits), or a code this
// feed has never shown before - falls to "Other" rather than being
// dropped, with a warning logged so an unrecognized code is visible,
// not silent.
const COUNTRY_TO_REGION = {
  USD: "New York",
  GBP: "London",
  EUR: "Frankfurt",
  CAD: "Toronto",
  JPY: "Tokyo",
  CNY: "Beijing",
  AUD: "Sydney",
  NZD: "Wellington",
};

const KNOWN_UNMAPPED_COUNTRIES = new Set(["CHF", "All"]);

function mapRegion(country) {
  const region = COUNTRY_TO_REGION[country];
  if (region) return region;
  if (!KNOWN_UNMAPPED_COUNTRIES.has(country)) {
    console.warn(`Calendar sync: unrecognized country code "${country}" - filing as "Other".`);
  }
  return "Other";
}

const VALID_IMPACTS = new Set(["high", "medium", "low"]);

function mapImpact(rawImpact) {
  const impact = String(rawImpact || "").toLowerCase();
  if (VALID_IMPACTS.has(impact)) return impact;
  console.warn(`Calendar sync: unrecognized impact value "${rawImpact}" - defaulting to "low".`);
  return "low";
}

async function fetchFeed() {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) {
      console.error(`Calendar sync: feed request failed (HTTP ${res.status}). Keeping existing calendar data.`);
      return null;
    }
    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error("Calendar sync: feed response was not an array - the feed's shape may have changed. Keeping existing calendar data.");
      return null;
    }
    return data;
  } catch (err) {
    console.error(`Calendar sync: feed fetch threw (${err.message}) - the feed may be down or unreachable. Keeping existing calendar data.`);
    return null;
  }
}

// One sync cycle: fetch, validate/map each entry, upsert into
// calendar_events with source='forexfactory'. A single malformed entry is
// skipped (logged, counted), never aborts the rest of the batch - same
// per-item isolation principle as the Markets Overview fix.
export async function syncForexFactoryCalendar() {
  const result = { processed: 0, skipped: 0, netNewRows: 0, regions: [], impacts: [], failed: false };
  const events = await fetchFeed();

  if (events === null) {
    result.failed = true;
  } else {
    const { rows: beforeRows } = await query("SELECT COUNT(*)::int AS count FROM calendar_events WHERE source = 'forexfactory'");
    const countBefore = beforeRows[0].count;

    const regionsSeen = new Set();
    const impactsSeen = new Set();

    for (const entry of events) {
      if (!entry || typeof entry.title !== "string" || !entry.title.trim() || !entry.date) {
        console.warn("Calendar sync: skipping malformed entry (missing title/date).", entry);
        result.skipped += 1;
        continue;
      }
      const eventTime = new Date(entry.date);
      if (Number.isNaN(eventTime.getTime())) {
        console.warn(`Calendar sync: skipping entry with unparseable date "${entry.date}" for "${entry.title}".`);
        result.skipped += 1;
        continue;
      }

      const region = mapRegion(entry.country);
      const impact = mapImpact(entry.impact);
      regionsSeen.add(region);
      impactsSeen.add(impact);

      try {
        // The ON CONFLICT below only catches an exact-to-the-minute
        // event_time repeat. In practice ForexFactory itself nudges an
        // event's reported time by a few minutes between fetches (a bond
        // auction's "provisional" time getting refined to its exact
        // completion time, for example) - found live as duplicate rows
        // for the same title+region a handful of minutes apart (e.g. two
        // "BOJ Policy Rate" rows 24 minutes apart on the same sync day).
        // Reconciling against any existing same title+region row within a
        // few hours - reusing its id via an UPDATE rather than inserting
        // a fresh row - closes that gap while still leaving two
        // genuinely different occurrences of a recurring title (weeks
        // apart) untouched.
        const { rows: nearbyRows } = await query(
          `SELECT id FROM calendar_events
           WHERE source = 'forexfactory' AND title = $1 AND region = $2
             AND event_time BETWEEN $3::timestamptz - interval '6 hours' AND $3::timestamptz + interval '6 hours'
           ORDER BY event_time ASC LIMIT 1`,
          [entry.title.trim(), region, eventTime]
        );

        if (nearbyRows.length > 0) {
          await query(
            `UPDATE calendar_events SET event_time = $2, impact = $3, forecast = $4, previous = $5
             WHERE id = $1`,
            [nearbyRows[0].id, eventTime, impact, entry.forecast || null, entry.previous || null]
          );
        } else {
          await query(
            `INSERT INTO calendar_events (title, event_time, impact, category, region, source, forecast, previous)
             VALUES ($1, $2, $3, 'macro', $4, 'forexfactory', $5, $6)
             ON CONFLICT (title, event_time)
             DO UPDATE SET impact = EXCLUDED.impact, region = EXCLUDED.region, forecast = EXCLUDED.forecast, previous = EXCLUDED.previous`,
            [entry.title.trim(), eventTime, impact, region, entry.forecast || null, entry.previous || null]
          );
        }
        result.processed += 1;
      } catch (err) {
        console.error(`Calendar sync: could not upsert "${entry.title}" - ${err.message}`);
        result.skipped += 1;
      }
    }

    const { rows: afterRows } = await query("SELECT COUNT(*)::int AS count FROM calendar_events WHERE source = 'forexfactory'");
    result.netNewRows = afterRows[0].count - countBefore;
    result.regions = [...regionsSeen];
    result.impacts = [...impactsSeen];
  }

  // Recorded whether this attempt succeeded or failed - a persistently
  // broken feed should only be retried once per interval, not on every
  // single request that happens to find the cache stale.
  await query(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
    [LAST_RUN_SETTING_KEY, new Date().toISOString()]
  );

  console.log(
    result.failed
      ? "Calendar sync: FAILED (feed unreachable or invalid shape) - existing calendar data left untouched."
      : `Calendar sync: complete - processed=${result.processed} skipped=${result.skipped} netNewRows=${result.netNewRows} regions=[${result.regions.join(",")}] impacts=[${result.impacts.join(",")}]`
  );
  return result;
}

async function isStale() {
  const { rows } = await query("SELECT value FROM settings WHERE key = $1", [LAST_RUN_SETTING_KEY]);
  if (rows.length === 0) return true;
  const lastRun = new Date(rows[0].value).getTime();
  return Date.now() - lastRun >= SYNC_INTERVAL_MS;
}

// True once a sync is actually in flight, so a burst of concurrent GET
// /api/calendar requests while stale triggers exactly one background
// sync, not one per request.
let syncPromise = null;

// Called from GET /api/calendar on every request (routes/calendar.js).
// Never awaited by the caller - always returns immediately. Checks
// staleness itself (not a boot-time timer - see the Markets Overview fix
// this mirrors) so correctness doesn't depend on the process staying up
// any particular length of time.
export function maybeSyncCalendarIfStale() {
  if (syncPromise) return;
  syncPromise = isStale()
    .then((stale) => (stale ? syncForexFactoryCalendar() : null))
    .catch((err) => console.error("Calendar sync: staleness check failed.", err))
    .finally(() => {
      syncPromise = null;
    });
}
