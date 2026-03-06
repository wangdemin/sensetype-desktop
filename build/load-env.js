/* eslint-disable no-console */
/**
 * Lightweight dotenv loader for electron-builder hooks.
 *
 * Why:
 * - electron-builder hooks run in Node and DO NOT automatically load Vite `.env*` files.
 * - Users often put CSC_* / APPLE_* / SENSETYPE_* into an env file.
 *
 * Behavior:
 * - If `SENSETYPE_ENV_FILE` is set, load that file (absolute or relative to projectDir).
 * - Otherwise, load first existing file in:
 *   .env, .env.local, .env.production, .env.production.local
 * - Never overwrite existing process.env values.
 */

const fs = require('node:fs');
const path = require('node:path');

function parseEnvFile(content) {
  const out = {};
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // Strip optional quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    out[key] = val;
  }
  return out;
}

function resolveEnvFile(projectDir) {
  const explicit = process.env.SENSETYPE_ENV_FILE;
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(projectDir, explicit);
  }

  const candidates = ['.env', '.env.local', '.env.production', '.env.production.local'];
  for (const rel of candidates) {
    const p = path.join(projectDir, rel);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

module.exports = function loadEnvForHook(context, opts = {}) {
  try {
    const projectDir =
      context && context.packager && context.packager.projectDir
        ? context.packager.projectDir
        : process.cwd();

    const envPath = resolveEnvFile(projectDir);
    if (!envPath) return;

    const content = fs.readFileSync(envPath, 'utf8');
    const parsed = parseEnvFile(content);
    const allowPrefixes = Array.isArray(opts.allowPrefixes) ? opts.allowPrefixes : null;
    const allowKeys = Array.isArray(opts.allowKeys) ? new Set(opts.allowKeys) : null;
    for (const [k, v] of Object.entries(parsed)) {
      if (allowKeys && !allowKeys.has(k)) continue;
      if (allowPrefixes && !allowPrefixes.some((p) => k.startsWith(p))) continue;
      if (process.env[k] === undefined) process.env[k] = v;
    }

    console.log('[load-env] Loaded:', envPath);
  } catch (e) {
    console.warn('[load-env] Failed to load env file:', e);
  }
};
