require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const translateRouter = require('./routes/translate');
const uploadRouter = require('./routes/upload');
const correctionsRouter = require('./routes/corrections');
const songsRouter = require('./routes/songs');
const audioRouter = require('./routes/audio');

const app = express();
const PORT = process.env.PORT || 3000;

// Em produção: define FRONTEND_URL no Render (ex: https://seu-app.vercel.app)
// Se não definida, libera todas as origens (ok para beta sem cookies/credenciais)
// Remove trailing slash caso FRONTEND_URL seja salva com "/" no final (ex: Render dashboard)
const frontendUrl = process.env.FRONTEND_URL?.replace(/\/+$/, '');
const corsOrigin = frontendUrl
  ? [frontendUrl, 'http://localhost:4200']
  : true;

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.use('/api', translateRouter);
app.use('/api', uploadRouter);
app.use('/api', correctionsRouter);
app.use('/api', songsRouter);
app.use('/api', audioRouter);

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);

  if (!process.env.GROQ_API_KEY) {
    console.warn('AVISO: GROQ_API_KEY não definida. Transcrição não funcionará.');
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('AVISO: ANTHROPIC_API_KEY não definida. Tradução não funcionará.');
  }
});
