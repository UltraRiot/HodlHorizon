import { Router } from "express";
import { query } from "../db.js";
import { maybeSyncCalendarIfStale } from "../services/calendar/syncForexFactory.js";

const router = Router();

const EVENT_FIELDS = "id, title, event_time, impact, category, region, forecast, previous";

async function selectEvents(whereClause, params) {
  const { rows } = await query(
    `SELECT ${EVENT_FIELDS} FROM (
       SELECT DISTINCT ON (title, region, date_trunc('day', event_time)) ${EVENT_FIELDS}
       FROM calendar_events
       WHERE ${whereClause}
       ORDER BY title, region, date_trunc('day', event_time), id DESC
     ) deduped
     ORDER BY event_time ASC`,
    params
  );
  return rows;
}

function utcDayStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function calendarWindows(now = new Date()) {
  const todayStart = utcDayStart(now);
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const isoDayOfWeek = (now.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  const daysUntilNextMonday = 7 - isoDayOfWeek;
  const nextMondayStart = new Date(todayStart.getTime() + daysUntilNextMonday * 24 * 60 * 60 * 1000);
  return { todayStart, tomorrowStart, nextMondayStart };
}

router.get("/today", async (req, res) => {
  maybeSyncCalendarIfStale();
  const { todayStart, tomorrowStart } = calendarWindows();
  const rows = await selectEvents("event_time >= $1 AND event_time < $2", [todayStart, tomorrowStart]);
  res.json(rows);
});

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
