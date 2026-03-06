/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */

// customSign.js
const { execFile } = require('child_process');
const { spawnSync } = require('child_process');
const fs = require('node:fs');
const path = require('node:path');

function execFileP(file, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log('-------------------正在签名-------------------');
    console.log('execFileP', file, args);
    console.log('--------------------签名结束------------------');
    execFile(file, args, { windowsHide: true, cwd }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function whereFirst(cmd) {
  try {
    const res = spawnSync('cmd.exe', ['/d', '/s', '/c', `where ${cmd}`], {
      encoding: 'utf8',
      windowsHide: true,
    });
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

function unquotePath(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

exports.default = async function (configuration) {
  const fileToSign = configuration.path;

  // 必填：证书指纹 + UKey密码
  const TP = process.env.WOTRUS_TP; // /tp 证书指纹串（Thumbprint）
  const PWD = process.env.WOTRUS_PWD; // /p Ukey密码
  const TS = process.env.WOTRUS_TS || 'http://timestamp.digicert.com';

  // wosigncodecmd.exe 的路径（推荐写绝对路径）
  const wosignFromEnv = unquotePath(process.env.WOSIGNCODECMD);
  const wosignFromEnvOk = wosignFromEnv && fs.existsSync(wosignFromEnv) ? wosignFromEnv : null;
  // 允许把 wosigncodecmd.exe 放到项目 scripts/ 目录（最省事）
  const wosignLocal = path.resolve(__dirname, 'wosigncodecmd.exe');
  const wosignLocalOk = fs.existsSync(wosignLocal) ? wosignLocal : null;

  const wosignFromWhere = whereFirst('wosigncodecmd.exe') || whereFirst('wosigncodecmd');
  // 用户要求：优先从 scripts/ 读取（即使环境变量存在也不抢占）
  const WOSIGN = wosignLocalOk || wosignFromEnvOk || wosignFromWhere || 'wosigncodecmd';

  if (!TP || !PWD) {
    throw new Error('Missing env: WOTRUS_TP / WOTRUS_PWD');
  }

  // 预检查：避免走到 execFile 里才报 ENOENT
  if (!wosignFromEnvOk && !wosignLocalOk && !wosignFromWhere) {
    throw new Error(
      [
        'wosigncodecmd not found.',
        '请安装/放置 wosigncodecmd.exe 并通过以下任一方式让脚本找到它：',
        '1) 设置环境变量 WOSIGNCODECMD 为 exe 的绝对路径（推荐）',
        `2) 或把 wosigncodecmd.exe 放到：${wosignLocal}`,
        '2) 或把 wosigncodecmd.exe 所在目录加入 PATH',
      ].join('\n'),
    );
  }

  const args = [
    'sign',
    '/tp',
    TP,
    '/p',
    PWD,
    '/hide',
    '/c',
    '/dig',
    'sha256',
    '/tr',
    TS,
    '/file',
    fileToSign,
  ];

  const cwd = WOSIGN && typeof WOSIGN === 'string' ? path.dirname(WOSIGN) : undefined;
  try {
    await execFileP(WOSIGN, args, cwd);
  } catch (e) {
    const errMsg = e && e.message ? String(e.message) : '';
    const errCode = e && e.code ? String(e.code) : '';
    const errExitCode = e && typeof e.exitCode !== 'undefined' ? String(e.exitCode) : '';
    throw new Error(
      `wosigncodecmd failed\n` +
        `cmd: ${WOSIGN}\n` +
        (cwd ? `cwd: ${cwd}\n` : '') +
        (errCode ? `code: ${errCode}\n` : '') +
        (errExitCode ? `exitCode: ${errExitCode}\n` : '') +
        (errMsg ? `message: ${errMsg}\n` : '') +
        `file: ${fileToSign}\n` +
        `stdout: ${e.stdout || ''}\n` +
        `stderr: ${e.stderr || ''}`,
    );
  }
};
