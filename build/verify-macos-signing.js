/* eslint-disable no-console */
/**
 * electron-builder hook: afterSign
 *
 * Optional release guardrails for mac signing.
 * Enable with `SENSETYPE_REQUIRE_DEV_ID=1`.
 *
 * What it checks:
 * - The built .app is NOT ad-hoc signed (must have a TeamIdentifier / Authority chain)
 * - codesign verify passes without structural errors
 *
 * This intentionally does NOT attempt notarization (see build/notarize-and-staple.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const loadEnv = require('./load-env');

function findFirstApp(appOutDir) {
  const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  const app = entries.find((e) => e.isDirectory() && e.name.endsWith('.app'));
  return app ? path.join(appOutDir, app.name) : null;
}

function runCaptureAll(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  return {
    code: typeof r.status === 'number' ? r.status : 0,
    text: `${stdout}${stderr}`,
    stdout,
    stderr,
  };
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

module.exports = async function afterSign(context) {
  try {
    if (context.electronPlatformName !== 'darwin') return;
    // IMPORTANT: do NOT load APPLE_* here, otherwise electron-builder 24.x may trigger built-in notarization and crash.
    loadEnv(context, { allowPrefixes: ['SENSETYPE_', 'CSC_'] });
    if (process.env.SENSETYPE_REQUIRE_DEV_ID !== '1') {
      console.log('[verify-macos-signing] Skipped (set SENSETYPE_REQUIRE_DEV_ID=1 to enable).');
      return;
    }

    const appPath = findFirstApp(context.appOutDir);
    if (!appPath) {
      console.warn('[verify-macos-signing] No .app found in:', context.appOutDir);
      return;
    }

    const dvRes = runCaptureAll('codesign', ['-dv', '--verbose=4', appPath]);
    const dv = dvRes.text || '';

    if (!dv.trim()) {
      throw new Error(
        `[verify-macos-signing] Failed to read codesign info (codesign -dv returned empty output).\n` +
          `Try running manually:\n` +
          `  codesign -dv --verbose=4 "${appPath}"\n`,
      );
    }

    if (dv.includes('Signature=adhoc') || dv.includes('TeamIdentifier=not set')) {
      const ids = runCaptureAll('security', ['find-identity', '-v', '-p', 'codesigning']).text;
      throw new Error(
        `[verify-macos-signing] App is not Developer ID signed (ad-hoc).\n` +
          `electron-builder likely skipped signing because it cannot find a VALID "Developer ID Application" identity.\n\n` +
          `What to check on this Mac:\n` +
          `- Your Developer ID Application certificate must be TRUSTED (a common error is missing WWDR intermediate -> CSSMERR_TP_NOT_TRUSTED)\n` +
          `- The certificate must include a private key, and codesign must be allowed to access it\n\n` +
          `Quick commands:\n` +
          `  security find-identity -v -p codesigning\n` +
          `  codesign -dv --verbose=4 "${appPath}"\n\n` +
          `security find-identity output:\n${ids}\n` +
          `codesign -dv output:\n${dv}`,
      );
    }

    console.log('[verify-macos-signing] codesign -dv OK (non-adhoc).');
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

    console.log('[verify-macos-signing] Done.');
  } catch (e) {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  }
};
