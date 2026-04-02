const express = require('express');
const router = express.Router();
const correctionsService = require('../services/correctionsService');

router.post('/corrections', (req, res) => {
  const { titulo, linha_en_original, linha_pt_original, linha_en_corrigida, linha_pt_corrigida } = req.body;

  if (!linha_en_original && !linha_pt_original) {
    return res.status(400).json({ error: 'Dados insuficientes.' });
  }

  const result = correctionsService.save({
    titulo,
    linha_en_original,
    linha_pt_original,
    linha_en_corrigida,
    linha_pt_corrigida,
  });

  return res.json({ ok: true, ...result });
});

router.get('/corrections', (_req, res) => {
  res.json(correctionsService.readAll());
});

module.exports = router;
