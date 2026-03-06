!macro customInstall
  ; 检查是否已安装 VC++ 2015-2022 (x64)
  ; 注册表路径: HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64
  ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  IntCmp $0 1 skip_vcredist

  DetailPrint "正在安装 Visual C++ Redistributable..."
  
  ; 将安装包解压到临时目录
  ; BUILD_RESOURCES_DIR 指向项目的 build/ 目录
  SetOutPath "$TEMP"
  File "${BUILD_RESOURCES_DIR}\VC_redist.x64.exe"
  
  ; 静默安装
  ExecWait '"$TEMP\VC_redist.x64.exe" /install /quiet /norestart'
  
  ; 清理临时文件
  Delete "$TEMP\VC_redist.x64.exe"
  
  ; 恢复安装目录路径
  SetOutPath "$INSTDIR"

  skip_vcredist:
!macroend
