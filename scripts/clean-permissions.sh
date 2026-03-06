#!/bin/bash

# macOS 权限缓存清理脚本
# 用于清除 Sensetype 应用在系统权限数据库中的残留记录

APP_BUNDLE_ID="master.sensetype"
APP_NAME="Sensetype"

echo "=========================================="
echo "清理 Sensetype 权限缓存"
echo "=========================================="
echo ""
echo "此脚本会清除应用在 macOS 权限数据库中的记录，"
echo "下次安装后需要重新授予权限。"
echo ""

# 检查是否有管理员权限
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  需要管理员权限来重置系统权限数据库"
    echo ""
    echo "请选择操作方式："
    echo "1. 使用 sudo 运行此脚本（推荐）"
    echo "2. 手动执行命令"
    echo ""
    read -p "请输入选项 (1/2): " choice
    
    if [ "$choice" = "1" ]; then
        echo ""
        echo "使用 sudo 重新运行脚本..."
        sudo "$0"
        exit $?
    else
        echo ""
        echo "请手动执行以下命令："
        echo ""
        echo "sudo tccutil reset Microphone ${APP_BUNDLE_ID}"
        echo "sudo tccutil reset Accessibility ${APP_BUNDLE_ID}"
        echo ""
        exit 0
    fi
fi

echo "正在清理权限缓存..."
echo ""

# 1. 重置麦克风权限
echo "1. 重置麦克风权限..."
if tccutil reset Microphone "${APP_BUNDLE_ID}" 2>/dev/null; then
    echo "   ✓ 麦克风权限已清除"
else
    echo "   ⚠️  清除麦克风权限失败（可能权限记录不存在）"
fi

# 2. 重置辅助功能权限
echo ""
echo "2. 重置辅助功能权限..."
if tccutil reset Accessibility "${APP_BUNDLE_ID}" 2>/dev/null; then
    echo "   ✓ 辅助功能权限已清除"
else
    echo "   ⚠️  清除辅助功能权限失败（可能权限记录不存在）"
fi

# 3. 重置所有权限（如果上面的方法不起作用）
echo ""
echo "3. 尝试重置所有权限类型..."
PERMISSION_TYPES=(
    "Microphone"
    "Accessibility"
    "Camera"
    "Contacts"
    "Calendar"
    "Reminders"
    "Photos"
    "Location"
    "SystemAdministration"
)

for perm_type in "${PERMISSION_TYPES[@]}"; do
    if tccutil reset "${perm_type}" "${APP_BUNDLE_ID}" 2>/dev/null; then
        echo "   ✓ ${perm_type} 权限已清除"
    fi
done

# 4. 清理用户级别的 TCC 数据库（如果存在）
echo ""
echo "4. 检查用户级别的权限数据库..."
USER_TCC_DB="$HOME/Library/Application Support/com.apple.TCC/TCC.db"
if [ -f "$USER_TCC_DB" ]; then
    echo "   找到用户 TCC 数据库: $USER_TCC_DB"
    echo "   注意：直接操作数据库需要 SQLite，建议使用 tccutil 命令"
fi

# 5. 清理系统级别的 TCC 数据库（如果存在）
SYSTEM_TCC_DB="/Library/Application Support/com.apple.TCC/TCC.db"
if [ -f "$SYSTEM_TCC_DB" ]; then
    echo ""
    echo "5. 检查系统级别的权限数据库..."
    echo "   找到系统 TCC 数据库: $SYSTEM_TCC_DB"
    echo "   系统数据库由 tccutil 命令管理，无需手动操作"
fi

echo ""
echo "=========================================="
echo "权限缓存清理完成！"
echo "=========================================="
echo ""
echo "下一步操作："
echo "1. 重新安装应用"
echo "2. 首次启动时会重新弹出权限请求"
echo "3. 在系统设置中确认权限已正确授予"
echo ""
echo "验证权限是否已清除："
echo "   系统设置 → 隐私与安全性 → 麦克风"
echo "   系统设置 → 隐私与安全性 → 辅助功能"
echo "   检查 ${APP_NAME} 是否还在列表中"
echo ""



