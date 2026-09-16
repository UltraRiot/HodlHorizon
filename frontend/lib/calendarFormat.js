// Shared by CalendarWidget.js (Today) and UpcomingCalendarWidget.js
// (Upcoming This Week) so this formatting logic lives in one place
// instead of being copied between the two.

// "Forecast: 0.4% · Prev: 0.6%" - only the fields that actually have a
// value (a lot of events have neither, per the live feed - a blank
// "Forecast: · Prev:" line reads as broken, not just empty), and null
// entirely when there's nothing to show, so the caller can skip the line.
export function forecastPreviousText(event) {
  const parts = [];
  if (event.forecast) parts.push(`Forecast: ${event.forecast}`);
  if (event.previous) parts.push(`Prev: ${event.previous}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
