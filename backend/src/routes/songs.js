const express = require('express');
const router = express.Router();
const songsService = require('../services/songsService');

router.post('/songs', (req, res) => {
  const { titulo, letra_original, letra_traduzida, analise_de_contexto, notas_culturais } = req.body;

  if (!letra_original || !letra_traduzida) {
    return res.status(400).json({ error: 'Letra incompleta.' });
  }

  const result = songsService.save({ titulo, letra_original, letra_traduzida, analise_de_contexto, notas_culturais });
  return res.json({ ok: true, ...result });
});

router.get('/songs', (_req, res) => {
  res.json(songsService.readAll());
});

module.exports = router;
