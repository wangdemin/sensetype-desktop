/* eslint-disable no-console */
// Similar to keyhook: ensure node-gyp rebuild works in both plain install and Electron rebuild.

const { spawnSync } = require('node:child_process');

function run(cmd, args, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return res.status ?? 1;
}

function main() {
  const extraEnv = {};
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
      '[sensetype-system-audio-win] node-gyp is not available; cannot build native addon.',
    );
    process.exit(1);
  }
  const exitCode = run(process.execPath, [nodeGypBin, 'rebuild'], extraEnv);
  process.exit(exitCode);
}

main();
