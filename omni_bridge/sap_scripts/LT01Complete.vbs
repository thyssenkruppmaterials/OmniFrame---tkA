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
session.findById("wnd[0]").resizeWorkingPane 128,23,false
session.findById("wnd[0]/tbar[0]/okcd").text = "LT01"
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtLTAK-LGNUM").text = "WH5"
session.findById("wnd[0]/usr/ctxtLTAK-BWLVS").text = "999"
session.findById("wnd[0]/usr/ctxtLTAP-MATNR").text = "23073723"
session.findById("wnd[0]/usr/txtRL03T-ANFME").text = "1"
session.findById("wnd[0]/usr/ctxtLTAP-WERKS").text = "8810"
session.findById("wnd[0]/usr/ctxtLTAP-LGORT").text = "RCV1"
session.findById("wnd[0]/usr/ctxtLTAP-CHARG").text = ""
session.findById("wnd[0]/usr/ctxtLTAP-CHARG").setFocus
session.findById("wnd[0]/usr/ctxtLTAP-CHARG").caretPosition = 1
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]/usr/ctxtLTAP-VLTYP").text = "110"
session.findById("wnd[0]/usr/ctxtLTAP-VLPLA").text = "RO-28-A-02"
session.findById("wnd[0]/usr/ctxtLTAP-NLTYP").text = "110"
session.findById("wnd[0]/usr/ctxtLTAP-NLPLA").text = "RO-28-A-02"
session.findById("wnd[0]/usr/txtLTAP-NLQNR").setFocus
session.findById("wnd[0]/usr/txtLTAP-NLQNR").caretPosition = 0
session.findById("wnd[0]").sendVKey 0
session.findById("wnd[0]").sendVKey 0
