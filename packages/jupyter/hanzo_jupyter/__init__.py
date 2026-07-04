"""Hanzo AI for JupyterLab — a prebuilt (federated) JupyterLab 4 extension.

The actual extension is JavaScript, shipped under ``hanzo_jupyter/labextension``
and discovered by JupyterLab at import time. This module only advertises where
that federated bundle lives so ``jupyter labextension list`` finds it.
"""

import json
from pathlib import Path

_HERE = Path(__file__).parent.resolve()

try:
    with (_HERE / "labextension" / "package.json").open() as f:
        __version__ = json.load(f)["version"]
except FileNotFoundError:  # not yet built (e.g. running from source)
    __version__ = "0.1.0"


def _jupyter_labextension_paths():
    """Tell JupyterLab where this prebuilt extension's assets live."""
    return [{"src": "labextension", "dest": "@hanzo/jupyter"}]
