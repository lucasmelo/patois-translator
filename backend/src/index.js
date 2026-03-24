require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const translateRouter = require('./routes/translate');

const app = express();
const PORT = process.env.PORT || 3000;

const allowedOrigins = process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL, 'http://localhost:4200']
  : ['http://localhost:4200'];

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.use('/api', translateRouter);

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);

  if (!process.env.GROQ_API_KEY) {
    console.warn('AVISO: GROQ_API_KEY não definida. Transcrição não funcionará.');
  }
  if (!process.env.GEMINI_API_KEY) {
    console.warn('AVISO: GEMINI_API_KEY não definida. Tradução não funcionará.');
  }
});
