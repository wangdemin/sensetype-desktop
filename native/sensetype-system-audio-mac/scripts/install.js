/* eslint-disable no-console */
// Ensures macOS SDKROOT is set then runs node-gyp rebuild.

const { spawnSync } = require('node:child_process');

function run(cmd, args, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return res.status ?? 1;
}

function getMacSdkPath() {
  const res = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  return out || null;
}

function main() {
  const extraEnv = {};
  if (!process.env.SDKROOT) {
    const sdk = getMacSdkPath();
    if (sdk) {
      extraEnv.SDKROOT = sdk;
      console.log('[sensetype-system-audio-mac] SDKROOT set to:', sdk);
    }
  }

  const runtime = process.env.npm_config_runtime;
  const target = process.env.npm_config_target;
  const isElectronRebuild = runtime === 'electron' || !!target;
  if (!isElectronRebuild) {
    extraEnv.npm_config_runtime = 'node';
    delete extraEnv.npm_config_target;
  }

  let nodeGypBin;
  try {
    nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
  } catch {
    console.error(
      '[sensetype-system-audio-mac] node-gyp is not available; cannot build native addon.',
    );
    process.exit(1);
  }

  const exitCode = run(process.execPath, [nodeGypBin, 'rebuild'], extraEnv);
  process.exit(exitCode);
}

main();
