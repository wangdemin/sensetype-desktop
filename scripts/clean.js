#!/usr/bin/env node

const fs = require('fs');
const os = require('node:os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function removeDir(dirPath) {
  if (fs.existsSync(dirPath)) {
    console.log(`删除目录: ${dirPath}`);
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } catch (error) {
      console.error(`删除 ${dirPath} 失败:`, error.message);
    }
  }
}

function removeFile(filePath) {
  if (fs.existsSync(filePath)) {
    console.log(`删除文件: ${filePath}`);
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.error(`删除 ${filePath} 失败:`, error.message);
    }
  }
}

const cacheOnly = hasFlag('--cache-only');
const deep = hasFlag('--deep');

console.log(cacheOnly ? '开始清理缓存...\n' : '开始清理构建产物...\n');

if (!cacheOnly) {
  // 清理构建目录
  removeDir(path.join(projectRoot, 'dist'));
  removeDir(path.join(projectRoot, 'dist-electron'));
  removeDir(path.join(projectRoot, 'release'));
}

// 清理缓存目录
removeDir(path.join(projectRoot, 'node_modules', '.vite'));
removeDir(path.join(projectRoot, 'node_modules', '.cache'));
removeDir(path.join(projectRoot, '.vite'));
removeDir(path.join(projectRoot, '.cache')); // 推荐把 electron-builder/electron cache 收敛到此目录

if (deep) {
  // 深度清理：清掉用户目录下的构建/下载缓存（可能占用大、也更“顽固”）
  // 注意：这些是可选的；如果你希望保留下载缓存来加速，可不要用 --deep
  const home = os.homedir();
  const candidates = [];

  if (process.platform === 'darwin') {
    // macOS 缓存路径
    candidates.push(
      path.join(home, 'Library', 'Caches', 'node-gyp'),
      path.join(home, 'Library', 'Caches', 'electron'),
      path.join(home, 'Library', 'Caches', 'electron-builder'),
    );
  } else if (process.platform === 'win32') {
    // Windows 缓存路径
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(
      path.join(localAppData, 'node-gyp', 'Cache'),
      path.join(localAppData, 'electron', 'Cache'),
      path.join(localAppData, 'electron-builder', 'Cache'),
    );
  }

  candidates.forEach((p) => removeDir(p));
}

// 清理原生模块构建产物
const nativeDirs = [
  path.join(projectRoot, 'native', 'sensetype-keyhook-mac'),
  path.join(projectRoot, 'native', 'sensetype-keyhook-win'),
  path.join(projectRoot, 'native', 'sensetype-system-audio-mac'),
  path.join(projectRoot, 'native', 'sensetype-system-audio-win'),
  // legacy (before split)
  path.join(projectRoot, 'native', 'sensetype-keyhook'),
];
const buildDirs = ['build', 'Release', 'Debug'];
nativeDirs.forEach((nativeDir) => {
  buildDirs.forEach((buildDir) => {
    const buildPath = path.join(nativeDir, buildDir);
    removeDir(buildPath);
  });
});

console.log('\n清理完成！');
console.log('\n建议执行以下命令重新构建:');
console.log(cacheOnly ? '  pnpm build' : '  pnpm rebuild-native && pnpm build');
console.log('  pnpm pack-mac');
