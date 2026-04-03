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
    `;

    await pool.query(createTableQuery);
    console.log('✅ Table created successfully!');
    
    const result = await pool.query('SELECT COUNT(*) FROM qr_links');
    console.log(`📊 Current rows in qr_links: ${result.rows[0].count}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
