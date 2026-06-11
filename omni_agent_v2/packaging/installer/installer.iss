; OmniAgent v2 -- Inno Setup script.
;
; This file is consumed by Inno Setup 6 (https://jrsoftware.org/isinfo.php)
; on Windows to produce ./dist/OmniAgent_v2_setup.exe. It is OPTIONAL --
; the primary distribution is the portable ZIP produced by build.ps1.
;
; The build.ps1 script invokes this file as:
;
;   iscc /Qp /DSourceDir=<path-to-dist\agent> /DOutputDir=<path-to-dist> ^
;        /DVersion=2.0.0 packaging\installer\installer.iss
;
; If those /D defines are missing (e.g. when running iscc by hand), the
; defaults below kick in and resolve relative to the installer.iss file
; itself, assuming the standard repo layout.

#ifndef Version
  #define Version "2.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist\agent"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\dist"
#endif

#define AppName       "OmniAgent v2"
#define AppPublisher  "OmniFrame / OneBox AI Logistics"
#define AppURL        "https://omniframe.app"
#define AppExeName    "agent-gui.exe"
#define AppHeadless   "agent.exe"
; A stable, randomly-generated GUID identifies the installed app for
; uninstall + upgrade purposes. DO NOT change once shipped -- Inno Setup
; uses it to detect a prior install and offer an in-place upgrade.
#define AppId         "{{8C2F1C3D-7A1B-4E22-9F5B-1A4B8F2C6A1A}}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#Version}
AppVerName={#AppName} {#Version}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/support
AppUpdatesURL={#AppURL}/agent/v2/latest

; Install per-user under %LOCALAPPDATA% so we don't need admin rights.
; PrivilegesRequired=lowest forces the user-mode prompt; PrivilegesRequiredOverridesAllowed
; lets a fleet manager re-elevate to per-machine if they want.
DefaultDirName={localappdata}\OmniFrame\Agent v2
DefaultGroupName=OmniFrame
DisableProgramGroupPage=auto
DisableDirPage=auto
UsePreviousAppDir=yes
UsePreviousGroup=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline

OutputDir={#OutputDir}
OutputBaseFilename=OmniAgent_v2_setup
Compression=lzma2/ultra
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
WizardResizable=no

; A minimum Windows 10 1809 build covers WebView2 Evergreen, the runtime
; Tauri 2 requires. Anything older fails on launch with a vague error;
; better to refuse install here.
MinVersion=10.0.17763

VersionInfoVersion={#Version}.0
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} installer
VersionInfoProductName={#AppName}

UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "runatlogin";  Description: "Start OmniAgent automatically when I sign in"; GroupDescription: "Startup behaviour:"

[Files]
; Copy the entire staged dist\agent\ folder recursively. The build script
; has already filtered out pyc/__pycache__/etc., so we don't filter here.
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}";        Filename: "{app}\{#AppExeName}"
Name: "{group}\Logs folder";       Filename: "{localappdata}\OmniFrame\Agent v2\logs"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}";  Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent

[Registry]
; Run-at-login: spawn the HEADLESS binary so the agent is up before the
; user opens the GUI. The user can still open agent-gui.exe to see status.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "OmniAgent v2"; ValueData: """{app}\{#AppHeadless}"""; \
    Tasks: runatlogin; Flags: uninsdeletevalue

; A small marker the auto-updater reads on first start to know the
; install root and that we own it.
Root: HKCU; Subkey: "Software\OmniFrame\Agent v2"; \
    ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; \
    Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\OmniFrame\Agent v2"; \
    ValueType: string; ValueName: "Version"; ValueData: "{#Version}"; \
    Flags: uninsdeletevalue

[UninstallDelete]
; Logs and the embedded python's __pycache__ accumulate after install --
; remove on uninstall so we leave a clean directory.
Type: filesandordirs; Name: "{app}\python\__pycache__"
Type: filesandordirs; Name: "{localappdata}\OmniFrame\Agent v2\logs"
; Do NOT delete the encrypted service-key file or config.json on uninstall
; without user opt-in -- a re-install should pick them up. The user can
; manually wipe {localappdata}\OmniFrame\Agent v2\ if they want a clean
; slate.

[Code]
function InitializeSetup(): Boolean;
var
    WebView2Path: string;
begin
    // Tauri 2 needs Evergreen WebView2. Windows 11 ships it preinstalled;
    // Windows 10 1809+ either has it from a Windows Update or needs the
    // bootstrapper. We don't bundle the bootstrapper here (it would inflate
    // the installer by ~6 MB and most fleets already have it) -- we just
    // warn if it's missing.
    if not RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', WebView2Path) then
        if not RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', WebView2Path) then
        begin
            MsgBox(
                'Microsoft Edge WebView2 Runtime was not detected on this machine.' #13#13 +
                'OmniAgent v2 needs WebView2 to render its UI. The installer will continue, ' +
                'but you may need to install WebView2 manually from:' #13 +
                'https://developer.microsoft.com/en-us/microsoft-edge/webview2/' #13#13 +
                'before launching the application.',
                mbInformation, MB_OK);
        end;
    Result := True;
end;
