/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */
// Rebuild native deps for Electron on macOS with a sane SDKROOT.
//
// IMPORTANT:
// This repo includes both mac/win native addons as optionalDependencies (pnpm link:).
// `electron-builder install-app-deps` will attempt to rebuild ALL native deps it sees,
// including the Windows addon, which fails on macOS and blocks rebuilding the mac addon.
//
// Therefore on macOS we explicitly rebuild ONLY what we need via node-gyp:
// - leveldown
// - sensetype-keyhook-mac

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('-')) return null;
  return v;
}

function getMacSdkPath() {
  const res = spawnSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  return out || null;
}

function getCpuCountDarwin() {
  try {
    const res = spawnSync('sysctl', ['-n', 'hw.ncpu'], { encoding: 'utf8' });
    const v = Number(String(res.stdout || '').trim());
    if (Number.isFinite(v) && v > 0) return v;
  } catch {
    //
  }
  return 4;
}

function getHardwareArchDarwin() {
  // NOTE:
  // - `uname -m` may return x86_64 when running under Rosetta on Apple Silicon.
  // - We want the *hardware* arch, so we consult sysctl first.
  try {
    const sysctl = spawnSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' });
    const v = String(sysctl.stdout || '').trim();
    if (v === '1') return 'arm64';
  } catch {
    //
  }
  const res = spawnSync('uname', ['-m'], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  const out = (res.stdout || '').trim();
  if (out === 'arm64' || out === 'x86_64') return out;
  return out || null;
}

function getFileInfo(p) {
  const res = spawnSync('file', [p], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  return (res.stdout || '').trim() || null;
}

function fileHasArch(fileInfo, targetArch) {
  if (!fileInfo) return false;
  const need = targetArch === 'arm64' ? 'arm64' : 'x86_64';
  return String(fileInfo).includes(need);
}

function pickNodeForArch(targetArch) {
  const preferred =
    targetArch === 'x64' ? process.env.SENSETYPE_NODE_X64 : process.env.SENSETYPE_NODE_ARM64;
  if (preferred && fs.existsSync(preferred)) {
    const info = getFileInfo(preferred);
    if (fileHasArch(info, targetArch)) return { nodePath: preferred, info };
  }

  // Common candidates on macOS:
  // - process.execPath (current node)
  // - /opt/homebrew/bin/node (Apple Silicon Homebrew)
  // - /usr/local/bin/node (Intel Homebrew / Node pkg installer; often x64 or universal)
  const candidates = [process.execPath, '/opt/homebrew/bin/node', '/usr/local/bin/node'].filter(
    Boolean,
  );

  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const info = getFileInfo(p);
      if (fileHasArch(info, targetArch)) return { nodePath: p, info };
    } catch {
      //
    }
  }

  return { nodePath: process.execPath, info: getFileInfo(process.execPath) };
}

function assertNativeArch({ moduleNodePath, targetArch }) {
  if (!fs.existsSync(moduleNodePath)) {
    throw new Error(`[rebuild-native:mac] native addon not found: ${moduleNodePath}`);
  }
  const info = getFileInfo(moduleNodePath);
  if (!info)
    throw new Error(`[rebuild-native:mac] failed to inspect native addon: ${moduleNodePath}`);

  const need = targetArch === 'arm64' ? 'arm64' : 'x86_64';
  if (!info.includes(need)) {
    throw new Error(
      `[rebuild-native:mac] native addon arch mismatch.\n` +
        `- target: ${targetArch}\n` +
        `- got: ${info}\n` +
        `Tip: on Apple Silicon, build x64 with Rosetta (arch -x86_64) and build arm64 with arm64 node (arch -arm64).`,
    );
  }
  console.log('[rebuild-native:mac] native addon OK:', info);
}

function getElectronVersionFromRepoRoot() {
  try {
    const pkg = require(path.join(process.cwd(), 'package.json'));
    const v = pkg && pkg.devDependencies && pkg.devDependencies.electron;
    if (typeof v === 'string' && v) return String(v).replace(/^[^0-9]*/, '');
  } catch {
    //
  }
  return null;
}

function getBuildStampPath(moduleDir) {
  return path.join(moduleDir, 'build', '.sensetype-rebuild-stamp.json');
}

function readBuildStamp(moduleDir) {
  const p = getBuildStampPath(moduleDir);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeBuildStamp(moduleDir, stamp) {
  const p = getBuildStampPath(moduleDir);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(stamp, null, 2));
  } catch {
    //
  }
}

function rebuildKeyhookViaNodeGyp({
  moduleDir,
  ebPlatform,
  ebArch,
  extraEnv,
  electronTarget,
  forceClean = false,
  jobs,
}) {
  console.warn('[rebuild-native:mac] rebuilding addon explicitly via node-gyp...');
  if (!fs.existsSync(moduleDir)) {
    console.error(
      `[rebuild-native:mac] keyhook module directory not found: ${moduleDir}\n` +
        `Fix: run \`pnpm install\` in the repo root (this repo uses pnpm "link:" optionalDependencies), then retry.`,
    );
    process.exit(1);
  }

  let nodeGypBin;
  try {
    nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js');
  } catch {
    console.error('[rebuild-native:mac] node-gyp is not available; cannot build native addon.');
    process.exit(1);
  }

  const env = {
    ...process.env,
    ...extraEnv,
    npm_config_runtime: 'electron',
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_build_from_source: 'true',
    npm_config_platform: ebPlatform,
    npm_config_arch: ebArch,
    npm_config_target_arch: ebArch,
    // Try to make native builds faster; respected by node-gyp/make on many setups.
    npm_config_jobs: String(jobs || ''),
    JOBS: String(jobs || ''),
    MAKEFLAGS: jobs ? `-j${jobs}` : process.env.MAKEFLAGS,
  };

  if (electronTarget) env.npm_config_target = String(electronTarget);

  if (forceClean) {
    try {
      fs.rmSync(path.join(moduleDir, 'build'), { recursive: true, force: true });
    } catch {
      //
    }
  }

  const hw = getHardwareArchDarwin();
  const picked = pickNodeForArch(ebArch);
  const nodeForTarget = picked.nodePath || process.execPath;
  const nodeInfo = picked.info || '';

  // On Apple Silicon hardware, building x64 requires an x86_64/universal Node (to run under Rosetta).
  if (hw === 'arm64' && ebArch === 'x64' && !fileHasArch(nodeInfo, 'x64')) {
    console.error(
      `[rebuild-native:mac] 无法在 Apple Silicon 上用当前 Node 重建 x64 原生模块。\n` +
        `- 目标架构: x64\n` +
        `- 当前 Node: ${nodeForTarget}\n` +
        `- Node 信息: ${nodeInfo || 'unknown'}\n\n` +
        `解决方案（二选一）：\n` +
        `1) 安装 Rosetta + 安装一个 x64/universal 的 node，并指定环境变量：\n` +
        `   export SENSETYPE_NODE_X64=/usr/local/bin/node\n` +
        `2) 在 Rosetta 终端里安装 x64 node（nvm under Rosetta），再运行 pack。\n`,
    );
    process.exit(1);
  }

  let cmd = nodeForTarget;
  const args = [nodeGypBin, 'rebuild'];
  if (jobs && Number.isFinite(Number(jobs)) && Number(jobs) > 0) {
    args.push('--jobs', String(jobs));
  }
  if (hw === 'arm64') {
    // Keep using `arch` wrapper for deterministic builds on Apple Silicon.
    cmd = 'arch';
    args.unshift(nodeForTarget);
    args.unshift(ebArch === 'x64' ? '-x86_64' : '-arm64');
  }

  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: moduleDir, env });
  if (res.error) console.error('[rebuild-native:mac] node-gyp spawn failed:', res.error);
  const ec = res.status ?? 1;
  if (ec !== 0) process.exit(ec);
}

const extraEnv = {};
if (!process.env.SDKROOT) {
  const sdk = getMacSdkPath();
  if (sdk) {
    extraEnv.SDKROOT = sdk;
    console.log('[rebuild-native:mac] SDKROOT set to:', sdk);
  }
}

const platform = getArgValue('--platform') || 'darwin';
const arch = getArgValue('--arch') || process.arch;
const force = hasFlag('--force');
const jobs = Number(getArgValue('--jobs') || '') || getCpuCountDarwin();

const ebPlatform = platform === 'darwin' ? 'darwin' : 'darwin';
const ebArch = arch === 'x64' || arch === 'arm64' ? arch : process.arch;
const electronTarget = getElectronVersionFromRepoRoot();

console.log('[rebuild-native:mac] rebuilding native deps for:', {
  platform: ebPlatform,
  arch: ebArch,
  electronTarget,
  jobs,
  force,
});

extraEnv.npm_config_platform = ebPlatform;
extraEnv.npm_config_arch = ebArch;
extraEnv.npm_config_target_arch = ebArch;

// 1) Rebuild leveldown (the only other native dependency used by this app)
let leveldownDir = path.join(process.cwd(), 'node_modules', 'leveldown');
try {
  leveldownDir = fs.realpathSync(leveldownDir);
} catch {
  //
}
if (fs.existsSync(leveldownDir)) {
  const leveldownNodePath = path.join(leveldownDir, 'build', 'Release', 'leveldown.node');
  let archOk = false;
  try {
    assertNativeArch({ moduleNodePath: leveldownNodePath, targetArch: ebArch });
    archOk = true;
  } catch {
    archOk = false;
  }

  const stamp = readBuildStamp(leveldownDir);
  const stampMatches =
    stamp &&
    stamp.platform === ebPlatform &&
    stamp.arch === ebArch &&
    String(stamp.electronTarget || '') === String(electronTarget || '');

  // If the binary already matches arch but we don't have a stamp (e.g. first run after this script update),
  // assume it's good and just write a stamp to avoid rebuilding from scratch.
  const canSkip = !force && archOk && (stampMatches || !stamp);
  if (canSkip) {
    console.log('[rebuild-native:mac] leveldown is up-to-date, skip:', leveldownNodePath);
    if (!stamp) {
      writeBuildStamp(leveldownDir, {
        module: 'leveldown',
        platform: ebPlatform,
        arch: ebArch,
        electronTarget,
        builtAt: new Date().toISOString(),
      });
    }
  } else {
    console.log('[rebuild-native:mac] rebuilding leveldown:', leveldownDir);
    rebuildKeyhookViaNodeGyp({
      moduleDir: leveldownDir,
      ebPlatform,
      ebArch,
      extraEnv,
      electronTarget,
      forceClean: true,
      jobs,
    });
    try {
      assertNativeArch({ moduleNodePath: leveldownNodePath, targetArch: ebArch });
      writeBuildStamp(leveldownDir, {
        module: 'leveldown',
        platform: ebPlatform,
        arch: ebArch,
        electronTarget,
        builtAt: new Date().toISOString(),
      });
    } catch {
      // If build output path differs, we still won't block; node-gyp would have errored on failure.
    }
  }
} else {
  console.warn(
    '[rebuild-native:mac] leveldown not found under node_modules, skipping:',
    leveldownDir,
  );
}

// Validate keyhook output (this repo uses pnpm link: optionalDependency)
let moduleDir = path.join(process.cwd(), 'node_modules', 'sensetype-keyhook-mac');
try {
  moduleDir = fs.realpathSync(moduleDir);
} catch {
  //
}
if (!fs.existsSync(moduleDir)) {
  console.error(
    `[rebuild-native:mac] keyhook package is not present under node_modules: ${moduleDir}\n` +
      `Fix: run \`pnpm install\` (without --no-optional) in the repo root, then retry.`,
  );
  process.exit(1);
}

const moduleNodePath = path.join(moduleDir, 'build', 'Release', 'sensetype_keyhook.node');
let needRebuild = false;

if (force) {
  needRebuild = true;
} else {
  try {
    assertNativeArch({ moduleNodePath, targetArch: ebArch });
  } catch (e) {
    needRebuild = true;
  }
}

if (needRebuild) {
  rebuildKeyhookViaNodeGyp({
    moduleDir,
    ebPlatform,
    ebArch,
    extraEnv,
    electronTarget,
    forceClean: true,
    jobs,
  });
  assertNativeArch({ moduleNodePath, targetArch: ebArch });
}

// If we got here, keyhook is good; persist a stamp so subsequent rebuilds can skip.
writeBuildStamp(moduleDir, {
  module: 'sensetype-keyhook-mac',
  platform: ebPlatform,
  arch: ebArch,
  electronTarget,
  builtAt: new Date().toISOString(),
});

// System audio (ScreenCaptureKit) addon (optionalDependency on darwin)
let sysAudioDir = path.join(process.cwd(), 'node_modules', 'sensetype-system-audio-mac');
try {
  sysAudioDir = fs.realpathSync(sysAudioDir);
} catch {
  //
}
if (!fs.existsSync(sysAudioDir)) {
  // Dev fallback: pnpm optionalDependencies can be skipped if install/build fails.
  // In that case, allow rebuilding directly from the repo's native folder.
  const fallbackDir = path.join(process.cwd(), 'native', 'sensetype-system-audio-mac');
  if (fs.existsSync(fallbackDir)) {
    console.warn(
      '[rebuild-native:mac] system-audio package not present under node_modules; rebuilding from native folder:',
      fallbackDir,
    );
    sysAudioDir = fallbackDir;
  } else {
    console.warn(
      '[rebuild-native:mac] system-audio package not present under node_modules, skip:',
      sysAudioDir,
    );
    process.exit(0);
  }
}

const sysAudioNodePath = path.join(sysAudioDir, 'build', 'Release', 'sensetype_system_audio.node');
let sysNeedRebuild = false;
if (force) {
  sysNeedRebuild = true;
} else {
  try {
    assertNativeArch({ moduleNodePath: sysAudioNodePath, targetArch: ebArch });
  } catch {
    sysNeedRebuild = true;
  }
}

if (sysNeedRebuild) {
  rebuildKeyhookViaNodeGyp({
    moduleDir: sysAudioDir,
    ebPlatform,
    ebArch,
    extraEnv,
    electronTarget,
    forceClean: true,
    jobs,
  });
  try {
    assertNativeArch({ moduleNodePath: sysAudioNodePath, targetArch: ebArch });
  } catch {
    // ignore; node-gyp would have errored on failure
  }
}

writeBuildStamp(sysAudioDir, {
  module: 'sensetype-system-audio-mac',
  platform: ebPlatform,
  arch: ebArch,
  electronTarget,
  builtAt: new Date().toISOString(),
});
