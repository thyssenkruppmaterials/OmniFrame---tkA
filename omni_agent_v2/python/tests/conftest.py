# Created and developed by Jai Singh
"""
Shared pytest configuration.

Adds the helper directory to sys.path so tests can `import sap_helper`,
`import session_manager`, etc. without requiring the helper to be
installed as a package.
"""
from __future__ import annotations

import os
import sys

_HELPER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _HELPER_DIR not in sys.path:
    sys.path.insert(0, _HELPER_DIR)

# Created and developed by Jai Singh
