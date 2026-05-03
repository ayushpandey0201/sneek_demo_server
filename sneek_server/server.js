require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createSneekRouter } = require('./src/sneek/sneek.routes');

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Parse allowed origins — support wildcard or comma-separated list
const allowedOrigins =
  CORS_ORIGIN === '*'
    ? true
    : CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);

const corsOptions = {
  origin: allowedOrigins,
  // Required when the frontend sends cookies or Authorization headers
  credentials: true,
  // Explicitly allow all methods used in the Sneek flow
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // Explicitly allow headers to prevent preflight (OPTIONS) failures
  allowedHeaders: ['Content-Type', 'Authorization', 'x-sneek-signature', 'X-Requested-With'],
};

// Apply CORS before everything else, including OPTIONS preflight
app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Handle preflight for all routes

app.use(express.json());

// Health-check route (Vercel and load balancers ping /)
app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'sneek-server', status: 'running' });
});

app.use(createSneekRouter());

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Sneek server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
