INSERT INTO settings (key, value) VALUES
  ('peak_window_euro_open_start', '06:30'),
  ('peak_window_euro_open_end', '07:30'),
  ('peak_window_us_open_start', '13:00'),
  ('peak_window_us_open_end', '14:00'),
  ('peak_window_us_close_start', '19:30'),
  ('peak_window_us_close_end', '21:30')
ON CONFLICT (key) DO NOTHING;
