/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */

// Rebuild native deps for Electron on Windows (mainly leveldown + optional keyhook).

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function readWorkspacePnpmStoreVersion() {
  try {
    const modulesYaml = path.join(process.cwd(), 'node_modules', '.modules.yaml');
    if (!fs.existsSync(modulesYaml)) return null;
    const raw = String(fs.readFileSync(modulesYaml, 'utf8') || '');
    // Example line:
    // storeDir: C:\Users\...\pnpm\store\v10
    const m = raw.match(/^\s*storeDir:\s*(.+)\s*$/m);
    if (!m) return null;
    const storeDir = m[1].trim().replace(/^['"]|['"]$/g, '');
    const v = storeDir.match(/[\\/]+store[\\/]+v(\d+)/i);
    if (!v) return null;
    const n = Number(v[1]);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function readWorkspacePnpmStoreDir() {
  try {
    const modulesYaml = path.join(process.cwd(), 'node_modules', '.modules.yaml');
    if (!fs.existsSync(modulesYaml)) return null;
    const raw = String(fs.readFileSync(modulesYaml, 'utf8') || '');
    const m = raw.match(/^\s*storeDir:\s*(.+)\s*$/m);
    if (!m) return null;
    const storeDir = m[1].trim().replace(/^['"]|['"]$/g, '');
    return storeDir || null;
  } catch {
    return null;
  }
}

function sh(cmd, args, extraEnv = {}, cwd = process.cwd()) {
  const env = { ...process.env, ...extraEnv };
  // On Windows, .cmd shims are not directly executable by spawnSync without a shell.
  const res =
    cmd.toLowerCase().endsWith('.cmd') || cmd.toLowerCase() === 'pnpm'
      ? spawnSync(
          'cmd.exe',
          [
            '/d',
            '/s',
            '/c',
            [cmd, ...args]
              .map((s) => {
                const str = String(s);
                return /[\s"]/g.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
              })
              .join(' '),
          ],
          { stdio: 'inherit', env, cwd },
        )
      : spawnSync(cmd, args, { stdio: 'inherit', env, cwd });
  if (res.error) console.error('[rebuild-native:win] spawn failed:', res.error);
  return res.status ?? 1;
}

function runCmdVersion(cmdPath) {
  try {
    const res = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${cmdPath}" -v`], {
      encoding: 'utf8',
    });
    if (res.status !== 0) return null;
    const out = String(res.stdout || '').trim();
    return out || null;
  } catch {
    return null;
  }
}

function parseMajor(version) {
  const m = String(version || '')
    .trim()
    .match(/^(\d+)\./);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('-')) return null;
  return v;
}

function getWinPnpmCmdPath() {
  try {
    const res = spawnSync('where', ['pnpm.cmd'], { encoding: 'utf8' });
    if (res.status !== 0) return null;
    const first = String(res.stdout || '')
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

function getWinPnpmCmdPaths() {
  try {
    const res = spawnSync('where', ['pnpm.cmd'], { encoding: 'utf8' });
    if (res.status !== 0) return [];
    return String(res.stdout || '')
      .split(/\r?\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function pickCompatiblePnpmCmdPath() {
  const storeV = readWorkspacePnpmStoreVersion(); // e.g. 10 / 3
  const preferMajor = storeV && storeV >= 10 ? 10 : storeV ? 9 : null;

  const candidates = [];
  // 1) Prefer pnpm.cmd alongside current node.exe (common with nvm installs)
  try {
    const sibling = path.join(path.dirname(process.execPath), 'pnpm.cmd');
    if (fs.existsSync(sibling)) candidates.push(sibling);
  } catch {
    //
  }
  // 2) Fallback to PATH results
  candidates.push(...getWinPnpmCmdPaths());

  const seen = new Set();
  const uniq = candidates.filter((p) => {
    const k = String(p).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!preferMajor) return uniq[0] || null;

  // If node_modules was installed with store v10, we must use pnpm major >= 10.
  // If store v3, use pnpm major < 10.
  const wantV10Plus = preferMajor >= 10;
  for (const p of uniq) {
    const ver = runCmdVersion(p);
    const major = parseMajor(ver);
    if (!major) continue;
    if (wantV10Plus ? major >= 10 : major < 10) return p;
  }

  // No compatible pnpm found; return first and let it fail with a clear message.
  return uniq[0] || null;
}

const extraEnv = {};
// Ensure pnpm rebuild uses the same store as current node_modules,
// otherwise pnpm may error with ERR_PNPM_UNEXPECTED_STORE.
const storeDir = readWorkspacePnpmStoreDir();
if (storeDir) {
  // pnpm respects PNPM_STORE_DIR; npm_config_store_dir is a common fallback.
  extraEnv.PNPM_STORE_DIR = storeDir;
  extraEnv.npm_config_store_dir = storeDir;
  console.log('[rebuild-native:win] storeDir pinned to:', storeDir);
}
const pnpmCmdPath = pickCompatiblePnpmCmdPath() || getWinPnpmCmdPath();
if (pnpmCmdPath) {
  // electron-builder uses npm_execpath to run the package manager.
  extraEnv.npm_execpath = pnpmCmdPath;
  extraEnv.npm_node_execpath = process.execPath;
  console.log('[rebuild-native:win] npm_execpath pinned to:', pnpmCmdPath);
}

const platform = getArgValue('--platform') || 'win32';
const arch = getArgValue('--arch') || process.arch;
const ebPlatform = platform === 'win32' ? 'win32' : 'win32';
const ebArch = arch === 'x64' || arch === 'arm64' || arch === 'ia32' ? arch : 'x64';

console.log('[rebuild-native:win] rebuilding native deps for:', {
  platform: ebPlatform,
  arch: ebArch,
});

extraEnv.npm_config_platform = ebPlatform;
extraEnv.npm_config_arch = ebArch;
extraEnv.npm_config_target_arch = ebArch;

// Use local electron-builder binary
const cmd = 'pnpm';
const args = [
  'exec',
  'electron-builder',
  'install-app-deps',
  '--platform',
  ebPlatform,
  '--arch',
  ebArch,
];
const ec = sh(cmd, args, extraEnv);
if (ec !== 0) process.exit(ec);

// Keyhook is critical for "hold Right Alt to record" on Windows.
// electron-builder install-app-deps may skip link: workspace deps, so we explicitly rebuild it here.
function getElectronVersion() {
  try {
    // Prefer the installed electron package version.
    return require('electron/package.json')?.version || null;
  } catch {
    // Fallback: root package.json devDependency.
    try {
      const rootPkg = require(path.join(process.cwd(), 'package.json'));
      return rootPkg?.devDependencies?.electron || rootPkg?.dependencies?.electron || null;
    } catch {
      return null;
    }
  }
}

function rebuildWinKeyhook() {
  const moduleDir = path.join(process.cwd(), 'native', 'sensetype-keyhook-win');
  if (!fs.existsSync(moduleDir)) {
    console.warn('[rebuild-native:win] keyhook module not found, skipped:', moduleDir);
    return 0;
  }

  const electronVersion = getElectronVersion();
  if (!electronVersion) {
    console.warn(
      '[rebuild-native:win] electron version not found; keyhook rebuild may target wrong ABI.',
    );
  }

  console.log('[rebuild-native:win] rebuilding sensetype-keyhook-win for Electron...', {
    electron: electronVersion,
    arch: ebArch,
  });

  const env = {
    ...extraEnv,
    // Make node-gyp build against Electron headers.
    npm_config_runtime: 'electron',
    ...(electronVersion
      ? { npm_config_target: String(electronVersion).replace(/^[^\d]*/, '') }
      : {}),
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_arch: ebArch,
    npm_config_target_arch: ebArch,
    npm_config_build_from_source: 'true',
  };

  // Run the module's install script (node-gyp rebuild with correct env).
  // Avoid `pnpm -C ... install` here to prevent generating a nested lockfile/node_modules.
  const installJs = path.join(moduleDir, 'scripts', 'install.js');
  const code = sh(process.execPath, [installJs], env, moduleDir);
  if (code !== 0) return code;

  // Sanity check: build output should exist.
  const buildDir = path.join(moduleDir, 'build');
  if (!fs.existsSync(buildDir)) {
    console.warn(
      '[rebuild-native:win] keyhook rebuild finished but build/ directory not found. Check your build tools.',
    );
  }
  return 0;
}

const keyhookEc = rebuildWinKeyhook();
if (keyhookEc !== 0) process.exit(keyhookEc);

// System audio loopback addon (optional)
function rebuildWinSystemAudio() {
  const moduleDir = path.join(process.cwd(), 'native', 'sensetype-system-audio-win');
  if (!fs.existsSync(moduleDir)) {
    console.warn('[rebuild-native:win] system-audio module not found, skipped:', moduleDir);
    return 0;
  }

  const electronVersion = getElectronVersion();
  console.log('[rebuild-native:win] rebuilding sensetype-system-audio-win for Electron...', {
    electron: electronVersion,
    arch: ebArch,
  });

  const env = {
    ...extraEnv,
    npm_config_runtime: 'electron',
    ...(electronVersion
      ? { npm_config_target: String(electronVersion).replace(/^[^\d]*/, '') }
      : {}),
    npm_config_disturl: 'https://electronjs.org/headers',
    npm_config_arch: ebArch,
    npm_config_target_arch: ebArch,
    npm_config_build_from_source: 'true',
  };

  const installJs = path.join(moduleDir, 'scripts', 'install.js');
  return sh(process.execPath, [installJs], env, moduleDir);
}

const sysAudioEc = rebuildWinSystemAudio();
if (sysAudioEc !== 0) process.exit(sysAudioEc);
