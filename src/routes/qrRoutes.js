const express = require('express');
const QRCode = require('qrcode');
const { getPool } = require('../db');
const { generateSlug } = require('../utils/slug');

const router = express.Router();

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

router.get('/api/qr', async (req, res, next) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, slug, target_url, scan_count, created_at FROM qr_links ORDER BY created_at DESC'
    );

    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.get('/q/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const pool = getPool();

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

    await pool.query('UPDATE qr_links SET scan_count = scan_count + 1 WHERE id = $1', [result.rows[0].id]);
    return res.redirect(302, result.rows[0].target_url);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
