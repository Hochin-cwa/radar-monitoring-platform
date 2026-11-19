"""
Helpers for safely writing and validating externally supplied values.

- sanitize_log(): neutralise CR/LF and other control characters before a value
  is written to a log (CWE-117 Log Forging).
- is_safe_ip() / is_safe_file_type(): whitelist validation used by the routers.
"""
from __future__ import annotations

import re

# C0/C1 control characters (includes \r \n \t) and Unicode line/paragraph separators
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029]")

_IP_RE = re.compile(r"^[A-Za-z0-9.:_\-]{1,64}$")          # IPv4 / IPv6 / simple host
_FILE_TYPE_RE = re.compile(r"^[A-Za-z0-9_.\-]{1,64}$")


def sanitize_log(value, max_len: int = 200) -> str:
    """Return a log-safe string: control characters -> '_', length capped."""
    text = "" if value is None else str(value)
    text = _CONTROL_CHARS.sub("_", text)
    if len(text) > max_len:
        text = text[:max_len] + "...(truncated)"
    return text


def is_safe_ip(value: str) -> bool:
    return isinstance(value, str) and _IP_RE.fullmatch(value) is not None


def is_safe_file_type(value: str) -> bool:
    return isinstance(value, str) and _FILE_TYPE_RE.fullmatch(value) is not None
