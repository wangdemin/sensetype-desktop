module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许自定义前缀：`win: ...` / `mac: ...`
    // 仍保留 conventional commits 的默认 types，避免破坏现有规范
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
        'win',
        'mac',
      ],
    ],
  },
};
