INSERT INTO settings (key, value) VALUES
  ('weekend_cap_stocks', '1'),
  ('weekend_cap_indices', '1'),
  ('weekend_cap_commodities', '1')
ON CONFLICT (key) DO NOTHING;
