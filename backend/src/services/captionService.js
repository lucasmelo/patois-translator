// Busca legendas automáticas do YouTube usando a InnerTube API (sem pacotes externos,
// sem download de áudio, sem cookies, funciona de qualquer IP incluindo datacenters).

const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const ANDROID_VERSION = '20.10.38';
const ANDROID_UA = `com.google.android.youtube/${ANDROID_VERSION} (Linux; U; Android 14)`;

function extractVideoId(rawUrl) {
  try {
    const url = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('?')[0];
    if (url.pathname.includes('/shorts/')) return url.pathname.split('/shorts/')[1].split('/')[0];
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

// Busca o título via oEmbed — sem API key, funciona de qualquer IP
async function getVideoTitle(videoId) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!res.ok) return 'Música sem título';
    const data = await res.json();
    return data.title || 'Música sem título';
  } catch {
    return 'Música sem título';
  }
}

// Consulta a InnerTube API para obter a lista de faixas de legenda do vídeo
async function fetchCaptionTracks(videoId) {
  const res = await fetch(INNERTUBE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ANDROID_UA,
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'ANDROID', clientVersion: ANDROID_VERSION },
      },
      videoId,
    }),
  });

  if (!res.ok) throw new Error(`InnerTube API retornou ${res.status}`);
  const data = await res.json();

  const tracks =
    data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  return Array.isArray(tracks) ? tracks : [];
}

// Retorna apenas faixas em inglês (manual 'en' ou gerada automaticamente 'en-*').
// Nunca faz fallback para outro idioma — a filosofia de tradução depende do texto em inglês/Patois.
function pickTrack(tracks) {
  const enTrack =
    tracks.find(t => t.languageCode === 'en') ||
    tracks.find(t => t.languageCode?.startsWith('en'));

  if (!enTrack) {
    const available = tracks.map(t => t.languageCode).join(', ');
    throw new Error(
      `Este vídeo não possui legendas em inglês (disponíveis: ${available || 'nenhuma'}). ` +
      `Use a aba "Colar Letra" e cole a letra original em inglês/Patois.`
    );
  }

  return enTrack;
}

// Decodifica entidades HTML básicas presentes no XML de legendas
function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

// Faz o parse do XML de legendas retornado pelo YouTube
// Suporta dois formatos: <p t="..." d="..."> (srv3) e <text start="..." dur="..."> (ttml)
function parseTranscriptXml(xml) {
  const segments = [];

  // Formato srv3: <p t="ms" d="ms">...<s>word</s>...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    let text = '';
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch;
    while ((sMatch = sRegex.exec(match[3])) !== null) text += sMatch[1];
    if (!text) text = match[3].replace(/<[^>]+>/g, '');
    text = decodeEntities(text).trim();
    if (text) segments.push(text);
  }

  if (segments.length > 0) return segments;

  // Fallback — formato ttml: <text start="s" dur="s">...</text>
  const textRegex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((match = textRegex.exec(xml)) !== null) {
    const text = decodeEntities(match[3]).trim();
    if (text) segments.push(text);
  }

  return segments;
}

async function fetchCaptions(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('URL do YouTube inválida ou não reconhecida.');

  const [title, tracks] = await Promise.all([
    getVideoTitle(videoId),
    fetchCaptionTracks(videoId),
  ]);

  if (tracks.length === 0) {
    throw new Error(
      'Este vídeo não possui legendas disponíveis. Use a aba "Colar Letra" e cole o texto manualmente.'
    );
  }

  const track = pickTrack(tracks);
  if (!track?.baseUrl) {
    throw new Error(
      'Não foi possível acessar as legendas deste vídeo. Use a aba "Colar Letra".'
    );
  }

  const xmlRes = await fetch(track.baseUrl, {
    headers: { 'User-Agent': ANDROID_UA },
  });
  if (!xmlRes.ok) throw new Error(`Falha ao baixar legenda (${xmlRes.status})`);
  const xml = await xmlRes.text();

  const segments = parseTranscriptXml(xml);
  if (segments.length === 0) {
    throw new Error(
      'As legendas deste vídeo estão em branco. Use a aba "Colar Letra".'
    );
  }

  // Junta em texto contínuo — mesmo formato de saída do Whisper,
  // que o systemPrompt já sabe reconstruir em versos com \n
  const text = segments.join(' ');

  return { title, text };
}

module.exports = { fetchCaptions, extractVideoId };
