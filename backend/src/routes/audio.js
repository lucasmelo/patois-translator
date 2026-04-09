const express = require('express');
const router = express.Router();
const fs = require('node:fs');
const path = require('node:path');
const audioStore = require('../services/audioStore');

const MIME_TYPES = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

router.get('/audio/:id', (req, res) => {
  const filePath = audioStore.get(req.params.id);
  if (!filePath) {
    return res.status(404).json({ error: 'Áudio expirado ou não encontrado.' });
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).json({ error: 'Arquivo de áudio não encontrado.' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

  const range = req.headers.range;

  if (range) {
    const [rawStart, rawEnd] = range.replace(/bytes=/, '').split('-');
    const start = Number.parseInt(rawStart, 10);
    const end = rawEnd ? Number.parseInt(rawEnd, 10) : stat.size - 1;
    const clampedEnd = Math.min(end, stat.size - 1);
    const chunkSize = clampedEnd - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${clampedEnd}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });

    const stream = fs.createReadStream(filePath, { start, end: clampedEnd });
    stream.on('error', (err) => {
      console.error('[Audio] Erro no stream (range):', err.message);
      if (res.headersSent) { res.destroy(); } else { res.status(500).end(); }
    });
    req.on('close', () => stream.destroy()); // cliente fechou — para o stream
    stream.pipe(res);

  } else {
    res.writeHead(200, {
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': mimeType,
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[Audio] Erro no stream:', err.message);
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  }
});

module.exports = router;
