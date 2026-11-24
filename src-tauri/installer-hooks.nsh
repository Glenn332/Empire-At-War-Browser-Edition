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

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\playeaw"
!macroend
