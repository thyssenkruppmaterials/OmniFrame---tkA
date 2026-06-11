# -*- mode: python ; coding: utf-8 -*-
# Documented equivalent of the Phase H.4 PyInstaller CLI in build_exe.bat.
# Run from omni_agent/ on Windows:
#   python -m PyInstaller --onefile --windowed --name OmniFrame_Connect ...

a = Analysis(
    ['omni_agent/connect/__main__.py'],
    pathex=['.'],
    hiddenimports=[
        'customtkinter',
        'psutil',
        'httpx',
        'yaml',
        'pywin32',
        'omni_agent.connect.connect_gui',
        'omni_agent.connect.capabilities',
        'omni_agent.connect.self_replace',
    ],
    datas=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)
# Prefer --collect-data customtkinter on the CLI invocation in build_exe.bat.
