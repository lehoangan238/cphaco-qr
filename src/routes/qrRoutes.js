const express = require('express');
const QRCode = require('qrcode');
const https = require('https');
const { getPool } = require('../db');
const { generateSlug } = require('../utils/slug');

const router = express.Router();
let scanTableReadyPromise;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(forwarded)
    ? forwarded[0]
    : (forwarded || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '';

  return rawIp.replace('::ffff:', '');
}

function isPrivateOrLocalIp(ip) {
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function httpsJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { timeout: timeoutMs }, (response) => {
      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Geolocation request timeout'));
    });

    request.on('error', reject);
  });
}

async function lookupApproxLocation(ip) {
  if (!ip || isPrivateOrLocalIp(ip)) {
    return { city: null, region: null, country: null, source: 'local' };
  }

  try {
    const data = await httpsJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!data.success) {
      return { city: null, region: null, country: null, source: 'unknown' };
    }

    return {
      city: data.city || null,
      region: data.region || null,
      country: data.country || null,
      source: 'ip'
    };
  } catch (error) {
    return { city: null, region: null, country: null, source: 'unknown' };
  }
}

function formatLocation(city, region, country) {
  const parts = [city, region, country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function ensureScanTable(pool) {
  if (!scanTableReadyPromise) {
    scanTableReadyPromise = (async () => {
      await pool.query(`
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
        )
      `);

      await pool.query('CREATE INDEX IF NOT EXISTS idx_qr_scans_link_scanned_at ON qr_scans(qr_link_id, scanned_at DESC)');
    })();
  }

  return scanTableReadyPromise;
}

function buildShortUrl(req, slug) {
  const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${baseUrl.replace(/\/$/, '')}/q/${slug}`;
}

async function ensureUniqueSlug(pool, requestedSlug) {
  let slug = requestedSlug || generateSlug();

  while (true) {
    const result = await pool.query('SELECT id FROM qr_links WHERE slug = $1 LIMIT 1', [slug]);
    if (result.rows.length === 0) {
      return slug;
    }

    if (requestedSlug) {
      const error = new Error('Slug already exists');
      error.statusCode = 409;
      throw error;
    }

    slug = generateSlug();
  }
}

router.post('/api/qr', async (req, res, next) => {
  try {
    const { target_url: targetUrl, slug: customSlug } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ message: 'target_url is required' });
    }

    const pool = getPool();
    const slug = await ensureUniqueSlug(pool, customSlug && customSlug.trim() ? customSlug.trim() : null);

    const result = await pool.query(
      'INSERT INTO qr_links (slug, target_url) VALUES ($1, $2) RETURNING id',
      [slug, targetUrl]
    );

    const shortUrl = buildShortUrl(req, slug);
    const qrDataUrl = await QRCode.toDataURL(shortUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320
    });

    return res.status(201).json({
      id: result.rows[0].id,
      slug,
      target_url: targetUrl,
      short_url: shortUrl,
      qr_code_base64: qrDataUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/api/qr/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { target_url: targetUrl } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ message: 'target_url is required' });
    }

    const pool = getPool();
    const result = await pool.query(
      'UPDATE qr_links SET target_url = $1 WHERE id = $2',
      [targetUrl, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'QR link not found' });
    }

    const rows = await pool.query('SELECT id, slug, target_url, scan_count, created_at FROM qr_links WHERE id = $1', [id]);

    return res.json(rows.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.get('/api/qr/:id/code', async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, slug, target_url FROM qr_links WHERE id = $1 LIMIT 1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'QR link not found' });
    }

    const row = result.rows[0];
    const shortUrl = buildShortUrl(req, row.slug);
    const qrDataUrl = await QRCode.toDataURL(shortUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320
    });

    return res.json({
      id: row.id,
      slug: row.slug,
      target_url: row.target_url,
      short_url: shortUrl,
      qr_code_base64: qrDataUrl
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/api/qr', async (req, res, next) => {
  try {
    const pool = getPool();
    await ensureScanTable(pool);

    const result = await pool.query(
      `SELECT
        q.id,
        q.slug,
        q.target_url,
        q.scan_count,
        q.created_at,
        s.city AS last_scan_city,
        s.region AS last_scan_region,
        s.country AS last_scan_country,
        s.scanned_at AS last_scanned_at
      FROM qr_links q
      LEFT JOIN LATERAL (
        SELECT city, region, country, scanned_at
        FROM qr_scans
        WHERE qr_link_id = q.id
        ORDER BY scanned_at DESC
        LIMIT 1
      ) s ON true
      ORDER BY q.created_at DESC`
    );

    return res.json(result.rows.map((row) => ({
      ...row,
      last_scan_location: formatLocation(row.last_scan_city, row.last_scan_region, row.last_scan_country)
    })));
  } catch (error) {
    return next(error);
  }
});

router.delete('/api/qr/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const pool = getPool();

    const result = await pool.query('DELETE FROM qr_links WHERE id = $1 RETURNING slug', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'QR link not found' });
    }

    return res.json({ message: 'QR link deleted', slug: result.rows[0].slug });
  } catch (error) {
    return next(error);
  }
});

router.get('/q/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const pool = getPool();
    await ensureScanTable(pool);

    const result = await pool.query('SELECT id, target_url FROM qr_links WHERE slug = $1 LIMIT 1', [slug]);

    if (result.rows.length === 0) {
      return res.status(404).send(`
        <!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>Not Found</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a; color: #f8fafc; }
              main { max-width: 32rem; padding: 2rem; text-align: center; }
              h1 { margin: 0 0 0.75rem; font-size: 2rem; }
              p { margin: 0; color: #cbd5e1; }
            </style>
          </head>
          <body>
            <main>
              <h1>404 - Link not found</h1>
              <p>The requested QR link does not exist.</p>
            </main>
          </body>
        </html>
      `);
    }

    const qrLinkId = result.rows[0].id;
    const clientIp = getClientIp(req);
    const location = await lookupApproxLocation(clientIp);

    await pool.query('UPDATE qr_links SET scan_count = scan_count + 1 WHERE id = $1', [qrLinkId]);
    await pool.query(
      `INSERT INTO qr_scans (qr_link_id, ip_address, city, region, country, location_source, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        qrLinkId,
        clientIp || null,
        location.city,
        location.region,
        location.country,
        location.source,
        req.headers['user-agent'] || null
      ]
    );

    return res.redirect(302, result.rows[0].target_url);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
