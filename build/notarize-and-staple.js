/**
 * electron-builder hook: afterAllArtifactBuild
 *
 * Goal:
 * - Notarize distributable artifacts (pkg/dmg/zip) with Apple's notarytool
 * - Staple ticket back to pkg/dmg (zip cannot be stapled)
 *
 * Enabled only when `SENSETYPE_NOTARIZE=1`.
 *
 * Credentials (choose one):
 * 1) Apple ID:
 *   - APPLE_ID
 *   - APPLE_APP_SPECIFIC_PASSWORD
 *   - APPLE_TEAM_ID
 *
 * 2) API Key:
 *   - APPLE_NOTARY_KEY        (path to .p8)
 *   - APPLE_NOTARY_KEY_ID
 *   - APPLE_NOTARY_ISSUER
 */

const path = require('node:path');
const { execFileSync } = require('node:child_process');

const loadEnv = require('./load-env');

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}

function getNotaryArgs() {
  const useAppleId =
    process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
  const useApiKey =
    process.env.APPLE_NOTARY_KEY &&
    process.env.APPLE_NOTARY_KEY_ID &&
    process.env.APPLE_NOTARY_ISSUER;

  if (useApiKey) {
    return [
      '--key',
      process.env.APPLE_NOTARY_KEY,
      '--key-id',
      process.env.APPLE_NOTARY_KEY_ID,
      '--issuer',
      process.env.APPLE_NOTARY_ISSUER,
    ];
  }
  if (useAppleId) {
    return [
      '--apple-id',
      process.env.APPLE_ID,
      '--password',
      process.env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id',
      process.env.APPLE_TEAM_ID,
    ];
  }
  return null;
}

function shouldStaple(p) {
  const ext = path.extname(p).toLowerCase();
  return ext === '.pkg' || ext === '.dmg' || ext === '.app';
}

module.exports = async function afterAllArtifactBuild(context) {
  try {
    if (context.electronPlatformName !== 'darwin') return;
    // 先只加载 SENSETYPE_*，避免把 APPLE_* 提前注入进程从而触发 electron-builder 内置 notarize（24.x 有已知崩溃风险）
    loadEnv(context, { allowPrefixes: ['SENSETYPE_'] });
    if (process.env.SENSETYPE_NOTARIZE !== '1') {
      console.log('[notarize] Skipped (set SENSETYPE_NOTARIZE=1 to enable notarization).');
      return;
    }
    // 真正需要 notarize 时，再加载 APPLE_* / CSC_* 等凭证
    loadEnv(context);

    const authArgs = getNotaryArgs();
    if (!authArgs) {
      console.warn(
        '[notarize] Missing credentials. Provide APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID or APPLE_NOTARY_KEY/APPLE_NOTARY_KEY_ID/APPLE_NOTARY_ISSUER.',
      );
      return;
    }

    const artifactPaths = Array.isArray(context.artifactPaths) ? context.artifactPaths : [];
    const targets = artifactPaths.filter((p) => {
      const ext = path.extname(p).toLowerCase();
      return ext === '.pkg' || ext === '.dmg' || ext === '.zip';
    });

    if (targets.length === 0) {
      console.log('[notarize] No .pkg/.dmg/.zip artifacts found to notarize.');
      return;
    }

    for (const artifact of targets) {
      console.log('[notarize] Submitting:', artifact);
      run('xcrun', ['notarytool', 'submit', artifact, '--wait', ...authArgs]);

      if (shouldStaple(artifact)) {
        console.log('[notarize] Stapling:', artifact);
        run('xcrun', ['stapler', 'staple', '-v', artifact]);
      } else {
        console.log('[notarize] Staple skipped (not supported):', artifact);
      }
    }

    console.log('[notarize] Done.');
  } catch (e) {
    console.warn('[notarize] Failed:', e);
  }
};
