export function forecastPreviousText(event) {
  const parts = [];
  if (event.forecast) parts.push(`Forecast: ${event.forecast}`);
  if (event.previous) parts.push(`Prev: ${event.previous}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}
