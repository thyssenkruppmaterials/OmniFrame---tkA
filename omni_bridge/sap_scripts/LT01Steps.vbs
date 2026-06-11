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
session.findById("wnd[0]").resizeWorkingPane 81,21,false
session.findById("wnd[0]/tbar[0]/okcd").text = "lt01"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = "WH5"
session.findById("wnd[0]/usr/ctxtLTAK-BWLVS").text = "999"
session.findById("wnd[0]/usr/ctxtLTAP-MATNR").text = "23067011"
session.findById("wnd[0]/usr/txtRL03T-ANFME").text = "1"
session.findById("wnd[0]/usr/ctxtLTAP-LGORT").text = "RCV1"
session.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").setFocus
session.findById("wnd[0]/usr/ctxtLTAP-SOBKZ").caretPosition = 0
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtLTAP-VLTYP").text = "110"
session.findById("wnd[0]/usr/ctxtLTAP-VLPLA").text = "k1-53-06-1"
session.findById("wnd[0]/usr/txtLTAP-VLQNR").text = ""
session.findById("wnd[0]/usr/ctxtLTAP-NLTYP").text = "110"
session.findById("wnd[0]/usr/ctxtLTAP-NLPLA").text = "k1-53-06-1"
session.findById("wnd[0]/usr/txtLTAP-NLQNR").setFocus
session.findById("wnd[0]/usr/txtLTAP-NLQNR").caretPosition = 0
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]").sendVKey 0
