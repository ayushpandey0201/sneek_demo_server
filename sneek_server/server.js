const express = require('express');
const cors = require('cors');
const { createSneekRouter } = require('./src/sneek/sneek.routes');

const app = express();
const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const corsOptions = {
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map((origin) => origin.trim()),
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(createSneekRouter());

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Sneek server running at http://localhost:${PORT}`);
  });
}

module.exports = app;
