If Not IsObject(application) Then
   Set SapGuiAuto  = GetObject("SAPGUI")
   Set application = SapGuiAuto.GetScriptingEngine
End If
If Not IsObject(connection) Then
   Set connection = application.Children(0)
End If
If Not IsObject(session) Then
   Set session    = connection.Children(0)
End If
If IsObject(WScript) Then
   WScript.ConnectObject session,     "on"
   WScript.ConnectObject application, "on"
End If
session.findById("wnd[0]").resizeWorkingPane 169,23,false
session.findById("wnd[0]/tbar[0]/okcd").text = "ls02n"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtLAGP-LGNUM").text = "JSF"
session.findById("wnd[0]/usr/ctxtLAGP-LGTYP").text = "150"
session.findById("wnd[0]/usr/ctxtLAGP-LGPLA").text = "RQ-37-B-03"
session.findById("wnd[0]/usr/ctxtLAGP-LGNUM").setFocus
session.findById("wnd[0]/usr/ctxtLAGP-LGNUM").caretPosition = 0
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUE").selected = true
session.findById("wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUA").selected = true
session.findById("wnd[0]/usr/tabsFUNC_TABSTRIP/tabpALLG/ssubD0400_S:SAPML01S:4001/chkLAGP-SKZUA").setFocus
session.findById("wnd[0]/tbar[0]/btn[11]").press
session.findById("wnd[0]/tbar[0]/btn[12]").press
