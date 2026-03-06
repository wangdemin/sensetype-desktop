#!/bin/bash

# macOS 系统级别清理脚本
# 用于清理 Sensetype 应用的所有系统残留

APP_ID="master.sensetype"
APP_NAME="Sensetype"
APP_BUNDLE_ID="master.sensetype"

echo "=========================================="
echo "清理 Sensetype 系统残留"
echo "=========================================="
echo ""

# 1. 查找并删除应用本身
echo "1. 查找应用安装位置..."
APP_LOCATIONS=(
    "/Applications/${APP_NAME}.app"
    "$HOME/Applications/${APP_NAME}.app"
    "/Applications/Sensetype -client_setup/${APP_NAME}.app"
)

for app_path in "${APP_LOCATIONS[@]}"; do
    if [ -d "$app_path" ]; then
        echo "   找到应用: $app_path"
        read -p "   是否删除此应用? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo "   正在删除..."
            rm -rf "$app_path"
            echo "   ✓ 已删除"
        fi
    fi
done

# 2. 清理偏好设置
echo ""
echo "2. 清理偏好设置..."
PREF_PATHS=(
    "$HOME/Library/Preferences/${APP_BUNDLE_ID}.plist"
    "$HOME/Library/Preferences/${APP_BUNDLE_ID}.*"
)

for pref_path in "${PREF_PATHS[@]}"; do
    if ls $pref_path 1> /dev/null 2>&1; then
        echo "   找到偏好设置: $pref_path"
        rm -f $pref_path
        echo "   ✓ 已删除"
    fi
done

# 3. 清理应用支持文件
echo ""
echo "3. 清理应用支持文件..."
SUPPORT_PATHS=(
    "$HOME/Library/Application Support/${APP_NAME}"
    "$HOME/Library/Application Support/${APP_BUNDLE_ID}"
)

for support_path in "${SUPPORT_PATHS[@]}"; do
    if [ -d "$support_path" ]; then
        echo "   找到应用支持目录: $support_path"
        rm -rf "$support_path"
        echo "   ✓ 已删除"
    fi
done

# 4. 清理缓存
echo ""
echo "4. 清理缓存..."
CACHE_PATHS=(
    "$HOME/Library/Caches/${APP_BUNDLE_ID}"
    "$HOME/Library/Caches/${APP_NAME}"
    "$HOME/Library/Saved Application State/${APP_BUNDLE_ID}.savedState"
)

for cache_path in "${CACHE_PATHS[@]}"; do
    if [ -d "$cache_path" ] || [ -f "$cache_path" ]; then
        echo "   找到缓存: $cache_path"
        rm -rf "$cache_path"
        echo "   ✓ 已删除"
    fi
done

# 5. 清理日志
echo ""
echo "5. 清理日志..."
LOG_PATHS=(
    "$HOME/Library/Logs/${APP_NAME}"
    "$HOME/Library/Logs/${APP_BUNDLE_ID}"
)

for log_path in "${LOG_PATHS[@]}"; do
    if [ -d "$log_path" ]; then
        echo "   找到日志目录: $log_path"
        rm -rf "$log_path"
        echo "   ✓ 已删除"
    fi
done

# 6. 清理容器（如果应用有沙盒）
echo ""
echo "6. 清理容器..."
CONTAINER_PATHS=(
    "$HOME/Library/Containers/${APP_BUNDLE_ID}"
    "$HOME/Library/Group Containers/${APP_BUNDLE_ID}.*"
)

for container_path in "${CONTAINER_PATHS[@]}"; do
    if ls $container_path 1> /dev/null 2>&1; then
        echo "   找到容器: $container_path"
        rm -rf $container_path
        echo "   ✓ 已删除"
    fi
done

# 7. 重置 Launch Services 数据库（需要管理员权限）
echo ""
echo "7. 重置 Launch Services 数据库..."
read -p "   是否重置 Launch Services 数据库? (需要管理员权限) (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user
    echo "   ✓ Launch Services 数据库已重置"
fi

# 8. 清理系统权限数据库（需要管理员权限）
echo ""
echo "8. 清理系统权限数据库..."
echo "   注意：这会重置所有应用的权限，请谨慎操作"
read -p "   是否重置麦克风权限? (需要管理员权限) (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo tccutil reset Microphone
    echo "   ✓ 麦克风权限已重置"
fi

read -p "   是否重置辅助功能权限? (需要管理员权限) (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    sudo tccutil reset Accessibility
    echo "   ✓ 辅助功能权限已重置"
fi

# 9. 清理 electron-store 数据
echo ""
echo "9. 清理 Electron Store 数据..."
STORE_PATHS=(
    "$HOME/Library/Application Support/${APP_NAME}/config.json"
    "$HOME/Library/Application Support/${APP_NAME}/storage"
)

for store_path in "${STORE_PATHS[@]}"; do
    if [ -f "$store_path" ] || [ -d "$store_path" ]; then
        echo "   找到存储数据: $store_path"
        rm -rf "$store_path"
        echo "   ✓ 已删除"
    fi
done

echo ""
echo "=========================================="
echo "清理完成！"
echo "=========================================="
echo ""
echo "建议操作："
echo "1. 重启 Mac（可选，但推荐）"
echo "2. 重新安装应用"
echo "3. 首次启动时会重新请求权限"
echo ""



