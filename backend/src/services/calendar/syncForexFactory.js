import { query } from "../../db.js";

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LAST_RUN_SETTING_KEY = "calendar_sync_last_run";

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

let syncPromise = null;

export function maybeSyncCalendarIfStale() {
  if (syncPromise) return;
  syncPromise = isStale()
    .then((stale) => (stale ? syncForexFactoryCalendar() : null))
    .catch((err) => console.error("Calendar sync: staleness check failed.", err))
    .finally(() => {
      syncPromise = null;
    });
}
