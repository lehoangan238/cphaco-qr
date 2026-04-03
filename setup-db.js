const { Pool } = require('pg');
require('dotenv').config();

async function setupDatabase() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔗 Connecting to Neon...');
    
    const createTableQuery = `
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
    `;

    await pool.query(createTableQuery);
    console.log('✅ Table created successfully!');
    
    const linksResult = await pool.query('SELECT COUNT(*) FROM qr_links');
    const scansResult = await pool.query('SELECT COUNT(*) FROM qr_scans');
    console.log(`📊 Current rows in qr_links: ${linksResult.rows[0].count}`);
    console.log(`📍 Current rows in qr_scans: ${scansResult.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
