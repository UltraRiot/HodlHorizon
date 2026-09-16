import { Router } from "express";
import { query } from "../db.js";
import { maybeSyncCalendarIfStale } from "../services/calendar/syncForexFactory.js";

const router = Router();

// Shared field list for both endpoints below, so it's defined once
// instead of twice - the join/select structure is otherwise identical,
// only the WHERE clause differs between "today" and "upcoming".
const EVENT_FIELDS = "id, title, event_time, impact, category, region, forecast, previous";

async function selectEvents(whereClause, params) {
  const { rows } = await query(
    `SELECT ${EVENT_FIELDS} FROM calendar_events WHERE ${whereClause} ORDER BY event_time ASC`,
    params
  );
  return rows;
}

// "Today"/"this week" boundaries, computed in UTC - explicitly, not left
// ambiguous. Chosen deliberately: this Postgres connection's ambient
// session timezone turned out to be Europe/Berlin (an accidental
// deployment artifact of wherever this DB happens to be hosted, not a
// considered choice), and event_time is stored as TIMESTAMPTZ - an
// absolute instant with no timezone of its own - so "today" has to pick
// SOME zone to draw its boundaries in. UTC is used because (a) it's the
// same zone the rest of this codebase already uses for day-boundary
// logic (see isWeekendUTC() in services/shared/articleUtils.js and the
// daily-cap reset it feeds), and (b) computing it here in JS with
// Date.UTC(...) - rather than relying on Postgres's now()/date_trunc(),
// which silently follows the session's ambient timezone - means this
// never depends on that Europe/Berlin default even if it changes.
function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// Monday-Sunday week, per the spec. JS's getUTCDay() is 0=Sunday..6=Saturday;
// converting to 0=Monday..6=Sunday makes "days until next Monday" a plain
// subtraction. When today IS Sunday, this correctly resolves to 1 (next
// Monday is tomorrow), so "the rest of this week" is empty - Sunday has
// no days left in a Monday-Sunday week, which is the right answer, not a
// special case to code around.
function calendarWindows(now = new Date()) {
  const todayStart = utcDayStart(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const isoDayOfWeek = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const daysUntilNextMonday = 7 - isoDayOfWeek;
  const nextMondayStart = new Date(todayStart.getTime() + daysUntilNextMonday * 24 * 60 * 60 * 1000);
  return { todayStart, tomorrowStart, nextMondayStart };
}

// GET /api/calendar/today - every impact level, strictly today (UTC),
// time ascending. Never blocks on the ForexFactory feed - always serves
// whatever's currently in the DB immediately, and separately (fire and
// forget, not awaited) asks the calendar to sync itself in the
// background if it's gone stale. Same "check staleness at request time,
// not a boot-time timer" pattern as the Markets Overview fix
// (services/marketData/overviewCache.js).
router.get("/today", async (req, res) => {
  maybeSyncCalendarIfStale();
  const { todayStart, tomorrowStart } = calendarWindows();
  const rows = await selectEvents("event_time >= $1 AND event_time < $2", [todayStart, tomorrowStart]);
  res.json(rows);
});

// GET /api/calendar/upcoming - high-impact only, strictly AFTER today
// through the end of this week (Sunday, UTC), time ascending. The lower
// bound (tomorrowStart) is exactly /today's upper bound, so the same
// event can never appear in both responses.
router.get("/upcoming", async (req, res) => {
  maybeSyncCalendarIfStale();
  const { tomorrowStart, nextMondayStart } = calendarWindows();
  const rows = await selectEvents(
    "impact = 'high' AND event_time >= $1 AND event_time < $2",
    [tomorrowStart, nextMondayStart]
  );
  res.json(rows);
});

export default router;
