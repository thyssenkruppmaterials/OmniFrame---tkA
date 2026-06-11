# -*- mode: python ; coding: utf-8 -*-
# Phase G — documentation / source-of-truth for OmniFrame_AgentMaster.exe
# Built from omni_agent/ via build_exe.bat (do not hand-edit Analysis paths on CI).
#
# Equivalent CLI (run from omni_agent/ after pip install -r requirements.txt):
#
#   python -m PyInstaller --onefile --windowed --name OmniFrame_AgentMaster ^
#       --hidden-import customtkinter ^
#       --hidden-import psutil ^
#       --hidden-import httpx ^
#       --hidden-import yaml ^
#       --hidden-import omni_agent.master.master_gui ^
#       --hidden-import omni_agent.master.capabilities ^
#       --collect-data customtkinter ^
#       --icon master_icon.ico ^
#       master\__main__.py

block_cipher = None

a = Analysis(
    ["master\\__main__.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[
        "customtkinter",
        "psutil",
        "httpx",
        "yaml",
        "omni_agent.master.master_gui",
        "omni_agent.master.capabilities",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
# CustomTkinter theme JSON — required at runtime (also passed on CLI as --collect-data).
from PyInstaller.utils.hooks import collect_data_files

a.datas += collect_data_files("customtkinter")

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="OmniFrame_AgentMaster",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="master_icon.ico",
)
