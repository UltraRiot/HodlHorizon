-- Peak windows around real market open/close moments (services/rss/
-- scanAndGenerate.js): a priority signal, not a hard gate - when the scan
-- runs inside one of these UTC time-of-day windows, fresh stories are
-- processed before older ones within the same category, so a real
-- open/close-moment story doesn't lose out to an older one that happens
-- to hit the daily cap first. Stored as "HH:MM" 24h UTC strings, same
-- settings-table pattern as daily_cap_*/weekend_cap_*, so the windows can
-- be retuned without a code change. ~30 minutes either side of each
-- stated moment (European open ~07:00 UTC, US open ~13:30 UTC, US close
-- ~20:00-21:00 UTC).
INSERT INTO settings (key, value) VALUES
  ('peak_window_euro_open_start', '06:30'),
  ('peak_window_euro_open_end', '07:30'),
  ('peak_window_us_open_start', '13:00'),
  ('peak_window_us_open_end', '14:00'),
  ('peak_window_us_close_start', '19:30'),
  ('peak_window_us_close_end', '21:30')
ON CONFLICT (key) DO NOTHING;
