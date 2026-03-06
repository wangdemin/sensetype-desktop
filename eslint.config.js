const js = require('@eslint/js');
const { FlatCompat } = require('@eslint/eslintrc');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');
const prettier = require('eslint-plugin-prettier');

const compat = new FlatCompat({ baseDirectory: __dirname });

/** @type {import('eslint').Linter.FlatConfig[]} */
module.exports = [
  {
    // 从旧的 .eslintignore 迁移到 flat config 的 ignores
    ignores: [
      'node_modules',
      'dist',
      'dist-electron',
      'release',
      '*.log',
      'eslint.config.js', // 配置文件自身不需要按项目规则检查
      '.eslintrc.cjs', // 旧配置文件，已迁移到 flat config
      'commitlint.config.cjs', // 非前端运行时代码，跳过
    ],
  },
  js.configs.recommended,
  // 将旧的 eslintrc 风格推荐配置转换为 flat config
  ...compat.extends(
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'plugin:prettier/recommended',
  ),
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react,
      'react-hooks': reactHooks,
      prettier,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prettier/prettier': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      // 未使用变量降级为 warn，避免阻塞提交
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },
  // JavaScript 文件特殊配置：将错误降级为警告
  {
    files: ['**/*.js', '**/*.jsx'],
    rules: {
      // 将 require() 导入错误降级为警告
      '@typescript-eslint/no-require-imports': 'warn',
      // 将未定义变量错误降级为警告（Node.js 全局变量如 require, module, process 等）
      'no-undef': 'warn',
    },
  },
];
