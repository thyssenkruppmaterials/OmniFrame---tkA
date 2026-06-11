' DeliveryData.vbs
' --------------------------------------------------------------------
' Source recording captured by the user on 2026-04-29 for the LT22
' Open Transfer-Order import (Worker-D, Phase D outbound). Archived
' verbatim so future agent work can reference the exact recorded path.
'
' Field reference:
'   T3_LGNUM        - Warehouse (S1_LGNUM in other transactions, but
'                     LT22 uses T3_*).
'   T3_LGTYP-LOW    - Storage type.
'   T3_SEVON        - Checkbox: include "verified" / fully-processed rows.
'                     Default the user wants OFF.
'   T3_SENAC        - Checkbox: include open + waiting-for-action rows.
'                     Default the user wants ON.
'   LISTV           - Saved layout variant. ONEBOXAPPX is the customer's
'                     pre-built outbound-friendly column set.
'
' Implemented in Python in: omni_agent/lt22_import.py (POST /sap/import-lt22)
' --------------------------------------------------------------------
session.findById("wnd[0]").resizeWorkingPane 109,25,false
session.findById("wnd[0]/tbar[0]/okcd").text = "LT22"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/chkT3_SEVON").selected = false   ' Show open + confirmed (false = OFF)
session.findById("wnd[0]/usr/chkT3_SENAC").selected = true    ' Open + waiting only (true = ON)
session.findById("wnd[0]/usr/ctxtT3_LGNUM").text = "PDC"      ' Warehouse
session.findById("wnd[0]/usr/ctxtT3_LGTYP-LOW").text = "916"  ' Storage type
session.findById("wnd[0]/usr/ctxtLISTV").text = "ONEBOXAPPX"  ' Layout variant
session.findById("wnd[0]/tbar[1]/btn[8]").press               ' F8 execute
