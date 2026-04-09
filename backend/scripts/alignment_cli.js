const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const backendRoot = path.join(__dirname, '..');
const venvDir = path.join(backendRoot, '.venv');
const isWindows = process.platform === 'win32';
const venvPython = path.join(venvDir, isWindows ? 'Scripts/python.exe' : 'bin/python');
const basePython = process.env.ALIGNER_PYTHON || 'python';
const requirementsPath = path.join(backendRoot, 'requirements-alignment.txt');
const probeScript = path.join(backendRoot, 'scripts/whisperx_force_align.py');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: backendRoot,
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureVenv() {
  if (!fs.existsSync(venvPython)) {
    run(basePython, ['-m', 'venv', venvDir]);
  }
}

function setup() {
  ensureVenv();
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  run(venvPython, ['-m', 'pip', 'install', '-r', requirementsPath]);
}

function probe() {
  ensureVenv();
  run(venvPython, [probeScript, '--probe']);
}

const command = process.argv[2];

if (command === 'setup') {
  setup();
} else if (command === 'probe') {
  probe();
} else {
  console.error('Uso: node scripts/alignment_cli.js <setup|probe>');
  process.exit(1);
}
