require('dotenv').config();

const express = require('express');
const path = require('path');
const qrRoutes = require('./routes/qrRoutes');
const { getPool } = require('./db');

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(qrRoutes);

app.get('/health', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database unavailable' });
  }
});

app.use((error, req, res, next) => {
  console.error(error);

  if (error.statusCode) {
    return res.status(error.statusCode).json({ message: error.message });
  }

  return res.status(500).json({ message: 'Internal server error' });
});

app.listen(port, () => {
  console.log(`Dynamic QR Code system running on http://localhost:${port}`);
  console.log('Admin dashboard: http://localhost:3000/');
});
