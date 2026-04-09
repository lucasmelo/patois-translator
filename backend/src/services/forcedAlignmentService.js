const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SCRIPT_PATH = path.join(__dirname, '../../scripts/whisperx_force_align.py');
const LOCAL_VENV_PYTHON = path.join(__dirname, '../../.venv/Scripts/python.exe');
const DEFAULT_TIMEOUT_MS = 8 * 60_000;
const DEFAULT_DEVICE = process.env.WHISPERX_DEVICE || 'cpu';
const DEFAULT_COMPUTE_TYPE = process.env.WHISPERX_COMPUTE_TYPE || 'int8';
const DEFAULT_PADDING_SECONDS = Number.parseFloat(process.env.WHISPERX_WINDOW_PADDING_SECONDS ?? '0.7');

let probePromise = null;

function getPythonBin() {
  if (process.env.ALIGNER_PYTHON) return process.env.ALIGNER_PYTHON;
  if (fs.existsSync(LOCAL_VENV_PYTHON)) return LOCAL_VENV_PYTHON;
  return 'python';
}

function isEnabled() {
  return process.env.FORCED_ALIGNMENT_ENABLED !== 'false';
}

function hasScript() {
  return fs.existsSync(SCRIPT_PATH);
}

function runPython(args, input, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(getPythonBin(), args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timeout ao executar alinhador (${timeoutMs}ms).`));
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Processo Python falhou com código ${code}.`));
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });

    if (input) child.stdin.write(input);
    child.stdin.end();
  });
}

async function probeAvailability() {
  if (!isEnabled() || !hasScript()) {
    return { available: false, reason: 'disabled_or_missing_script' };
  }

  if (!probePromise) {
    probePromise = runPython([SCRIPT_PATH, '--probe'], null, 20_000)
      .then(({ stdout }) => JSON.parse(stdout || '{}'))
      .catch(error => ({ available: false, error: error.message }));
  }

  return probePromise;
}

function getPreviousTimestamp(index, timestamps) {
  for (let i = index - 1; i >= 0; i--) {
    if (timestamps[i]) return timestamps[i];
  }
  return null;
}

function getNextTimestamp(index, timestamps) {
  for (let i = index + 1; i < timestamps.length; i++) {
    if (timestamps[i]) return timestamps[i];
  }
  return null;
}

function buildAlignmentWindows(lines, coarseTimestamps) {
  return lines.flatMap((text, index) => {
    const trimmed = text.trim();
    const coarse = coarseTimestamps[index];
    if (!trimmed || !coarse) return [];

    const previous = getPreviousTimestamp(index, coarseTimestamps);
    const next = getNextTimestamp(index, coarseTimestamps);
    const gapBefore = previous ? Math.max(0, coarse.start - previous.end) : DEFAULT_PADDING_SECONDS;
    const gapAfter = next ? Math.max(0, next.start - coarse.end) : DEFAULT_PADDING_SECONDS;
    const startPadding = Math.min(DEFAULT_PADDING_SECONDS, 0.25 + gapBefore * 0.6);
    const endPadding = Math.min(DEFAULT_PADDING_SECONDS, 0.25 + gapAfter * 0.6);

    const start = Math.max(0, coarse.start - startPadding);
    const end = Math.max(start + 0.2, coarse.end + endPadding);

    return [{
      index,
      text: trimmed,
      start,
      end,
      originalStart: coarse.start,
      originalEnd: coarse.end,
    }];
  });
}

function mergeAlignedWithCoarse(lines, coarseTimestamps, alignedLines) {
  const alignedByIndex = new Map(alignedLines.map(line => [line.index, line]));

  return lines.map((line, index) => {
    if (!line.trim()) return null;

    const coarse = coarseTimestamps[index];
    const aligned = alignedByIndex.get(index);
    if (!coarse) return aligned ? { start: aligned.start, end: aligned.end } : null;
    if (!aligned) return coarse;

    const start = Number.isFinite(aligned.start) ? aligned.start : coarse.start;
    const end = Number.isFinite(aligned.end) ? aligned.end : coarse.end;

    if (end <= start) return coarse;
    return { start, end };
  });
}

/**
 * @returns {Promise<{ lineTimestamps: Array<{start:number,end:number}|null>, lineWords: Array<{index:number,words:Array<{text:string,start:number,end:number}>}> } | null>}
 */
async function alignLineTimestamps(audioPath, lyrics, coarseTimestamps, language = 'en') {
  const probe = await probeAvailability();
  if (!probe.available) return null;

  const lines = (lyrics ?? '').split('\n');
  const windows = buildAlignmentWindows(lines, coarseTimestamps);
  if (windows.length === 0) return null;

  try {
    const payload = {
      audioPath,
      language,
      device: DEFAULT_DEVICE,
      computeType: DEFAULT_COMPUTE_TYPE,
      lines: windows,
    };

    const { stdout } = await runPython([SCRIPT_PATH], JSON.stringify(payload));
    const parsed = JSON.parse(stdout || '{}');
    if (!Array.isArray(parsed.lines)) return null;

    const lineTimestamps = mergeAlignedWithCoarse(lines, coarseTimestamps, parsed.lines);
    const lineWords = Array.isArray(parsed.lineWords) ? parsed.lineWords : [];

    return { lineTimestamps, lineWords };
  } catch (error) {
    console.warn(`[Align] Forced alignment indisponível neste request: ${error.message}`);
    return null;
  }
}

module.exports = { probeAvailability, alignLineTimestamps };
