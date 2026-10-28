Unicode true
Target amd64-unicode
!include "LogicLib.nsh"
!include "x64.nsh"
!include "WinVer.nsh"

!ifndef VERSION
  !error "VERSION is required"
!endif
!ifndef PAYLOAD_DIR
  !error "PAYLOAD_DIR is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif

Name "Game UI Studio"
Caption "Game UI Studio ${VERSION}"
OutFile "${OUTPUT_FILE}"
Icon "${PAYLOAD_DIR}/game-ui-studio.ico"
UninstallIcon "${PAYLOAD_DIR}/game-ui-studio.ico"
InstallDir "$LOCALAPPDATA\Programs\Game UI Studio"
InstallDirRegKey HKCU "Software\GameUIStudio" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
SetOverwrite on
ShowInstDetails show
ShowUninstDetails show
AutoCloseWindow true
BrandingText "Game UI Studio - Local game UI design and review"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Game UI Studio"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Game UI Studio per-user installer (Windows x64)"
VIAddVersionKey "LegalCopyright" "Game UI Studio contributors - MIT License"

Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Function .onInit
  SetShellVarContext current
  SetRegView 64
  ; A second install location would share the same user data and uninstall keys.
  ; Require an explicit uninstall first instead of leaving two conflicting copies.
  ReadRegStr $0 HKCU "Software\GameUIStudio" "InstallLocation"
  StrCmp $0 "" same_location
  GetFullPathName $0 "$0"
  GetFullPathName $1 "$INSTDIR"
  StrCmp $0 $1 same_location
  IfSilent +2
  MessageBox MB_OK|MB_ICONSTOP "Game UI Studio is already installed in $0. Uninstall that copy before choosing a different installation folder. Your project data will be kept."
  SetErrorLevel 2
  Quit
same_location:
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "Game UI Studio requires 64-bit Windows 10 or Windows 11."
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "Game UI Studio requires Windows 10 or Windows 11."
    SetErrorLevel 2
    Quit
  ${EndIf}
FunctionEnd

Function un.onInit
  SetShellVarContext current
  SetRegView 64
FunctionEnd

; Stop only this application's authenticated instance. Never kill all node.exe processes.
; The launcher returns zero only when no instance remains. Data is outside $INSTDIR.
!macro StopStudio PREFIX
Function ${PREFIX}StopStudio
  IfFileExists "$INSTDIR\node.exe" 0 stopped
  IfFileExists "$INSTDIR\app\scripts\desktop-launcher.mjs" 0 broken
  DetailPrint "Stopping Game UI Studio before changing application files..."
  ClearErrors
  ExecWait '"$INSTDIR\node.exe" "$INSTDIR\app\scripts\desktop-launcher.mjs" --stop' $0
  IfErrors broken
  StrCmp $0 "0" stopped broken
broken:
  IfSilent +2
  MessageBox MB_OK|MB_ICONSTOP "Game UI Studio could not be stopped safely. Use the Stop Game UI Studio shortcut, then run this installer again. Your project data has been kept."
  SetErrorLevel 2
  Quit
stopped:
FunctionEnd
!macroend
!insertmacro StopStudio ""
!insertmacro StopStudio "un."

Section "Game UI Studio"
  Call StopStudio
  ; Replacing this program-only folder prevents stale modules on upgrades.
  RMDir /r "$INSTDIR\app"
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD_DIR}/*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Game UI Studio"
  CreateShortCut "$DESKTOP\Game UI Studio.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\game-ui-studio.ico" 0 SW_SHOWNORMAL "" "Open Game UI Studio in your browser"
  CreateShortCut "$SMPROGRAMS\Game UI Studio\Game UI Studio.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs"' "$INSTDIR\game-ui-studio.ico" 0
  CreateShortCut "$SMPROGRAMS\Game UI Studio\Stop Game UI Studio.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs" --stop' "$INSTDIR\game-ui-studio.ico" 0
  CreateShortCut "$SMPROGRAMS\Game UI Studio\Project data.lnk" "$LOCALAPPDATA\GameUIStudio\data"
  CreateShortCut "$SMPROGRAMS\Game UI Studio\Uninstall.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\game-ui-studio.ico" 0

  WriteRegStr HKCU "Software\GameUIStudio" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "DisplayName" "Game UI Studio"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "DisplayIcon" '$\"$INSTDIR\game-ui-studio.ico$\",0'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "Publisher" "Game UI Studio contributors"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "URLInfoAbout" "https://github.com/sleeper-lfy/my-prototype"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio" "NoRepair" 1
  IfSilent done
  ExecShell "open" "$SYSDIR\wscript.exe" '"$INSTDIR\launch.vbs"'
done:
SectionEnd

Section "Uninstall"
  Call un.StopStudio
  Delete "$DESKTOP\Game UI Studio.lnk"
  RMDir /r "$SMPROGRAMS\Game UI Studio"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio"
  DeleteRegKey HKCU "Software\GameUIStudio"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\launch.vbs"
  Delete "$INSTDIR\game-ui-studio.ico"
  Delete "$INSTDIR\NODE-LICENSE.txt"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.txt"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DetailPrint "Your projects and imported assets remain in $LOCALAPPDATA\GameUIStudio\data."
SectionEnd
