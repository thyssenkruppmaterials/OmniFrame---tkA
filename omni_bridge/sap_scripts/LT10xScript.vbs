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
session.findById("wnd[0]").resizeWorkingPane 131,19,false
session.findById("wnd[0]/tbar[0]/okcd").text = "LT10"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtS1_LGNUM").text = "WH5"
session.findById("wnd[0]/usr/ctxtS1_LGTYP-LOW").text = "*"
session.findById("wnd[0]/usr/ctxtMATNR-LOW").text = "RR30000237"
session.findById("wnd[0]/usr/ctxtMATNR-LOW").setFocus
session.findById("wnd[0]/usr/ctxtMATNR-LOW").caretPosition = 10
session.findById("wnd[0]/tbar[1]/btn[8]").press
