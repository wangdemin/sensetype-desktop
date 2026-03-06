/**
 * electron-builder hook: afterPack
 *
 * Purpose:
 * - Provide a "stable" local signing behavior on macOS without requiring a Developer ID certificate.
 * - Ad-hoc sign the .app bundle with the project's entitlements so microphone/audio-input works more reliably.
 *
 * Notes:
 * - This is NOT notarization and will NOT bypass Gatekeeper for internet-downloaded apps.
 * - It's intended for local/testing distribution (DMG/ZIP) where you control the install.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const loadEnv = require('./load-env');

function findFirstApp(appOutDir) {
  const entries = fs.readdirSync(appOutDir, { withFileTypes: true });
  const app = entries.find((e) => e.isDirectory() && e.name.endsWith('.app'));
  return app ? path.join(appOutDir, app.name) : null;
}

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

module.exports = async function afterPack(context) {
  try {
    // Only for mac builds
    if (context.electronPlatformName !== 'darwin') return;
    // IMPORTANT: do NOT load APPLE_* here, otherwise electron-builder 24.x may trigger built-in notarization and crash.
    loadEnv(context, { allowPrefixes: ['SENSETYPE_', 'CSC_'] });

    // IMPORTANT:
    // Accessibility (TCC) authorization persistence on macOS depends on a stable code requirement.
    // Ad-hoc signing ("-") makes the code requirement change across builds/versions, which causes
    // users to be repeatedly prompted to re-enable Accessibility after each install/update.
    //
    // However, WITHOUT any signing, entitlements (like microphone access) won't work at all.
    // So we default to ad-hoc signing if no Developer ID certificate is available.
    // For real distribution, use a stable Developer ID Application certificate signing flow.
    const enableAdhoc =
      process.env.SENSETYPE_ADHOC_SIGN === '1' || process.env.SENSETYPE_ADHOC_SIGN !== '0'; // Default to true if not explicitly disabled
    if (!enableAdhoc) {
      console.log('[afterPack-adhoc-sign] Skipped (SENSETYPE_ADHOC_SIGN=0).');
      return;
    }

    const appOutDir = context.appOutDir;
    const projectDir =
      context.packager && context.packager.projectDir ? context.packager.projectDir : process.cwd();
    const entitlements = path.join(projectDir, 'build', 'entitlements.mac.plist');

    const appPath = findFirstApp(appOutDir);
    if (!appPath) {
      console.warn('[afterPack-adhoc-sign] No .app found in:', appOutDir);
      return;
    }

    if (!fs.existsSync(entitlements)) {
      console.warn('[afterPack-adhoc-sign] Entitlements not found:', entitlements);
      return;
    }

    console.log('[afterPack-adhoc-sign] Ad-hoc signing:', appPath);
    console.log('[afterPack-adhoc-sign] Using entitlements:', entitlements);

    // Ad-hoc sign with hardened runtime option + entitlements.
    // "--deep" is pragmatic for Electron bundles (Frameworks/Helpers).
    run('codesign', [
      '--force',
      '--deep',
      '--sign',
      '-',
      '--options',
      'runtime',
      '--entitlements',
      entitlements,
      appPath,
    ]);

    // Verify signature (best-effort; spctl may still fail due to no notarization)
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);

    console.log('[afterPack-adhoc-sign] Done.');
  } catch (e) {
    console.warn('[afterPack-adhoc-sign] Failed:', e);
  }
};
