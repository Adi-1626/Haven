; Haven NSIS hooks, included by electron-builder (see electron-builder.config.cjs).
; User data lives in %APPDATA%\Haven, outside $INSTDIR, and is never touched by install or update.

!ifndef BUILD_UNINSTALLER
  ; Finish page: launch Haven (as the installing user) and an optional desktop shortcut.
  !macro customFinishPage
    Function HavenStartApp
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" ""
    FunctionEnd

    Function HavenDesktopShortcut
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
      System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_TEXT "Launch Haven"
    !define MUI_FINISHPAGE_RUN_FUNCTION "HavenStartApp"
    !define MUI_FINISHPAGE_SHOWREADME
    !define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
    !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "HavenDesktopShortcut"
    !insertmacro MUI_PAGE_FINISH
  !macroend
!endif

!macro customUnInstall
  ; Updates run the previous uninstaller with --updated; keep shortcuts, startup and data then.
  ${ifNot} ${isUpdated}
    ; The desktop shortcut is optional, so electron-builder does not track it.
    ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      WinShell::UninstShortcut "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endif}

    ; Remove the "Start Haven when I sign in" entry only if it points at this installation.
    ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
    ${if} $0 != ""
      ; Match the executable including its closing quote. A directory prefix could also
      ; match another installation such as Haven-other and erase its startup setting.
      StrLen $1 '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\"'
      StrCpy $2 $0 $1
      ${if} $2 == '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\"'
        DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
      ${else}
        ; Retain support for unquoted legacy values, with an argument boundary.
        StrLen $1 "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        StrCpy $2 $0 $1
        StrCpy $3 $0 1 $1
        ${if} $2 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
          ${if} $3 == ""
          ${orIf} $3 == " "
            DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${APP_ID}"
          ${endif}
        ${endif}
      ${endif}
    ${endif}

    ; Data removal is opt-in. Silent uninstalls keep data unless --delete-app-data is passed.
    ; "Haven" matches app.setName('Haven') in apps/desktop/electron/main.cjs.
    ${if} $APPDATA != ""
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Haven data on this PC?$\r$\n$\r$\nThis permanently removes local communities, messages, sign-in and settings stored in:$\r$\n$APPDATA\Haven$\r$\n$\r$\nChoose No to keep them for a future installation." /SD IDNO IDNO havenKeepData
        RMDir /r "$APPDATA\Haven"
      havenKeepData:
    ${endif}
  ${endif}
!macroend
