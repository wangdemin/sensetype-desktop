/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
// Dispatcher: run the platform-specific rebuild script to avoid mac/win logic coupling.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('-')) return null;
  return v;
}

const targetPlatform = getArgValue('--platform') || process.platform;
const script =
  targetPlatform === 'darwin'
    ? path.join(__dirname, 'rebuild-native-mac.js')
    : targetPlatform === 'win32'
      ? path.join(__dirname, 'rebuild-native-win.js')
      : null;

if (!script) {
  console.error(`[rebuild-native] Unsupported platform: ${targetPlatform}`);
  process.exit(1);
}

const res = spawnSync(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
