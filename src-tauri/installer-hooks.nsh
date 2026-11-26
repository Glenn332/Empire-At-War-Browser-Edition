VIAddVersionKey "CompanyName" "Glenn332"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R9 SHCTX "${MANUPRODUCTKEY}" ""
  ${If} $R9 == ""
    ReadRegStr $R9 SHCTX "Software\RIRA\${PRODUCTNAME}" ""
    ${If} $R9 != ""
    ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ${AndIf} ${FileExists} "$R9\${MAINBINARYNAME}.exe"
      StrCpy $INSTDIR $R9
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
  DeleteRegKey SHCTX "Software\RIRA\${PRODUCTNAME}"
  DeleteRegKey /ifempty SHCTX "Software\RIRA"
!macroend

; playeaw:// invite links open the installed app (src/invite.rs reads them)
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\playeaw" "" "URL:Empire at War Browser Edition"
  WriteRegStr HKCU "Software\Classes\playeaw" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\playeaw\DefaultIcon" "" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\playeaw\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Classes\playeaw"
  ${EndIf}
!macroend
