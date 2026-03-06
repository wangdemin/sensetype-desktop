/* eslint-disable no-console */
// Ensures macOS SDKROOT is set so clang can find libc++ headers (e.g. <functional>)
// then runs node-gyp rebuild to compile the native addon.

const { spawnSync } = require('node:child_process');

function run(cmd, args, extraEnv = {}) {
  const res = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
  return res.status ?? 1;
}

function getMacSdkPath() {
  const res = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], {
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  return out || null;
}

function main() {
  const extraEnv = {};

  if (process.platform === 'darwin') {
    // Many modern CLT setups only have libc++ headers under the SDK path,
    // so without SDKROOT clang may fail to find <functional>.
    if (!process.env.SDKROOT) {
      const sdk = getMacSdkPath();
      if (sdk) {
        extraEnv.SDKROOT = sdk;
        console.log('[sensetype-keyhook] SDKROOT set to:', sdk);
      } else {
        console.warn('[sensetype-keyhook] failed to resolve SDKROOT via xcrun; build may fail.');
      }
    }
  }

  // Some environments export npm_config_runtime=electron globally, which makes loaders
  // look for electron prebuilds and fail during plain `pnpm install`.
  // Force a plain node build ONLY for the normal install step.
  // If we're being rebuilt for Electron (electron-builder install-app-deps / npm rebuild),
  // do NOT override runtime/target/arch, otherwise we may accidentally build the wrong ABI/arch
  // (e.g. always arm64) and cause "arch mismatch" during packaging.
  const runtime = process.env.npm_config_runtime;
  const target = process.env.npm_config_target;
  const isElectronRebuild = runtime === 'electron' || !!target;
  if (!isElectronRebuild) {
    extraEnv.npm_config_runtime = 'node';
    delete extraEnv.npm_config_target;
  }

  // Run node-gyp rebuild.
  let nodeGypBin;
  try {
    nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
  } catch {
    console.error('[sensetype-keyhook] node-gyp is not available; cannot build native addon.');
    process.exit(1);
  }

  const exitCode = run(process.execPath, [nodeGypBin, 'rebuild'], extraEnv);
  process.exit(exitCode);
}

main();
