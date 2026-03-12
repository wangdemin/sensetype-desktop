import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { CodeInspectorPlugin } from 'code-inspector-plugin';
import electron from 'vite-plugin-electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import svgr from 'vite-plugin-svgr';

const isSupportedDesktopPlatform = process.platform === 'darwin' || process.platform === 'win32';
const mainEntry =
  process.platform === 'darwin'
    ? './src/main/mac/index.ts'
    : process.platform === 'win32'
      ? './src/main/win/index.ts'
      : null;
const mainProcessFile =
  process.platform === 'darwin'
    ? 'src/main/mac/index.ts'
    : process.platform === 'win32'
      ? 'src/main/win/index.ts'
      : null;

export default defineConfig(({ command }) => ({
  // 生产环境需要相对路径，确保 file:// 下资源能加载，否则会白屏
  base: command === 'serve' ? '/' : './',
  // 生产构建移除 console/debugger，避免打包版日志导致卡顿/无响应
  esbuild: command === 'serve' ? undefined : { drop: ['console', 'debugger'] },
  plugins: [
    svgr(),
    react(),
    // 仅在开发环境启用，避免生产包体积增加
    ...(command === 'serve' ? [CodeInspectorPlugin({ bundler: 'vite' })] : []),
    ...(isSupportedDesktopPlatform
      ? [
          electron([
            {
              // 让 mac / win 主进程入口彻底拆开：构建时只编译当前平台的入口与依赖
              entry: mainEntry,
              vite: {
                esbuild: command === 'serve' ? undefined : { drop: ['console', 'debugger'] },
                build: {
                  // 构建出口
                  outDir: 'dist-electron/main',
                  minify: command === 'serve' ? false : 'esbuild',
                  rollupOptions: {
                    // 保持原生模块不被打包，运行时动态加载
                    external: [
                      'child_process',
                      'pouchdb',
                      'sensetype-keyhook-mac',
                      'sensetype-keyhook-win',
                      'sensetype-system-audio-win',
                      'sensetype-system-audio-mac',
                      'leveldown',
                    ],
                  },
                },
              },
            },
          ]),
        ]
      : []),
  ],
  build: {
    sourcemap: false,
    minify: command === 'serve' ? false : 'esbuild',
    rollupOptions: {
      // 注意：renderer 运行在浏览器环境，不能 external 掉 axios，否则生产包会报
      // Failed to resolve module specifier "axios"
      external: ['pouchdb'],
    },
  },
  resolve: {
    alias: [
      {
        find: '@/renderer/hooks/useVoiceRecognition',
        replacement: path.resolve(
          __dirname,
          process.platform === 'win32'
            ? './src/renderer/hooks/win/useVoiceRecognition.ts'
            : './src/renderer/hooks/mac/useVoiceRecognition.ts',
        ),
      },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
  },
  server: {
    host: '0.0.0.0',
    port: 8888,
  },
  pluginOptions: isSupportedDesktopPlatform
    ? {
        electronBuilder: {
          nodeIntegration: true,
          mainProcessFile,
          mainProcessWatch: ['src/main'],
          externals: [
            'pouchdb',
            'extract-file-icon',
            'npm',
            'electron-screenshots',
            '@electron/remote',
            'sensetype-keyhook-mac',
            'sensetype-keyhook-win',
            'sensetype-system-audio-win',
            'sensetype-system-audio-mac',
            'leveldown',
          ],
        },
      }
    : undefined,
}));
