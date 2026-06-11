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
session.findById("wnd[0]").resizeWorkingPane 113,27,false
session.findById("wnd[0]/tbar[0]/okcd").text = "lt12"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/txtLTAK-TANUM").text = "7281779"
session.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = "WH5"
session.findById("wnd[0]/usr/chkRL03T-OFPOS").setFocus
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/tbar[0]/btn[11]").press
