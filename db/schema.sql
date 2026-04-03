CREATE TABLE IF NOT EXISTS qr_links (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  scan_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS qr_scans (
  id SERIAL PRIMARY KEY,
  qr_link_id INTEGER NOT NULL REFERENCES qr_links(id) ON DELETE CASCADE,
  ip_address VARCHAR(64),
  city VARCHAR(120),
  region VARCHAR(120),
  country VARCHAR(120),
  location_source VARCHAR(20) NOT NULL DEFAULT 'unknown',
  user_agent TEXT,
  scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qr_scans_link_scanned_at ON qr_scans(qr_link_id, scanned_at DESC);
