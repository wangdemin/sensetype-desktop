# sensetype-client

## 开发说明（Windows：全局长按右 Alt 录音 + 拦截按键）

为了在**外部应用（例如浏览器输入框）**里实现“按住 **右 Alt** 录音，并且不让浏览器收到该按键”，需要启用原生 keyhook 模块：

- Windows：`sensetype-keyhook-win`
- macOS：`sensetype-keyhook-mac`

本分支不再维护 `uiohook-napi` 降级路径；keyhook 原生模块不可用时会直接提示修复原生模块。

### Windows 必要条件（启用 sensetype-keyhook-win 编译）

- 安装 **Python 3.x（建议 3.11）**，并确保能在命令行运行：

```bash
python --version
```

- 安装 **Visual Studio Build Tools 2022**（勾选 “Desktop development with C++” + Windows 10/11 SDK）
- 若 `node-gyp` 找不到 Python，可显式配置（把路径替换成你本机的 python.exe）：

```bash
npm config set python "C:\Path\To\Python311\python.exe"
```

然后在项目根目录执行：

```bash
pnpm run rebuild-native
```

## macOS 打包发布（解决“未知来源”/安装警告）

目前项目产出的 `.pkg` 默认是 **未签名** 的（可用 `pkgutil --check-signature xxx.pkg` 验证），在其它机器（尤其是从网络下载）安装时，macOS 会提示 **“未知来源”** / Gatekeeper 警告。这不是 x64/arm64 的区别导致的，而是发布链路缺少 **Developer ID 签名 + 公证（notarization）+ stapling**。

本项目已加入两个可选 hook（默认不影响本地调试打包）：

- `build/verify-macos-signing.js`（electron-builder `afterSign`）：当 `SENSETYPE_REQUIRE_DEV_ID=1` 时，强制要求 `.app` 不是 ad-hoc 签名，否则直接失败（防止发出去才发现“未知来源”）。
- `build/notarize-and-staple.js`（electron-builder `afterAllArtifactBuild`）：当 `SENSETYPE_NOTARIZE=1` 时，对最终产物（`.pkg/.dmg/.zip`）执行 `xcrun notarytool submit --wait`，并对 `.pkg/.dmg` 执行 `xcrun stapler staple`。

### 发布前需要的环境变量

**签名证书（electron-builder）**

- `CSC_LINK` / `CSC_KEY_PASSWORD`（Developer ID Application）
- `CSC_INSTALLER_LINK` / `CSC_INSTALLER_KEY_PASSWORD`（Developer ID Installer，用于 `.pkg`）

**公证（notarytool，二选一）**

- Apple ID 方式：
  - `APPLE_ID`
  - `APPLE_APP_SPECIFIC_PASSWORD`
  - `APPLE_TEAM_ID`
- API Key 方式（更适合 CI）：
  - `APPLE_NOTARY_KEY`（`.p8` 路径）
  - `APPLE_NOTARY_KEY_ID`
  - `APPLE_NOTARY_ISSUER`

### 建议命令

- 本地测试（允许无签名/不公证）：

```bash
pnpm pack-mac:pkg
```

- 发布模式（强制签名 + 公证）：

```bash
SENSETYPE_REQUIRE_DEV_ID=1 SENSETYPE_NOTARIZE=1 pnpm pack-mac:pkg
```

### Apple Silicon 上构建 x64/arm64 原生模块

`scripts/rebuild-native.js` 已改为在 Apple Silicon 上强制用 `arch -x86_64` / `arch -arm64` 来 rebuild，并在 rebuild 后校验 keyhook 的 `.node` 架构；这样可以避免出现“arm64 包里夹带 x86_64 原生模块”导致某个平台安装后异常的情况。
