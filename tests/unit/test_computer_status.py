"""
Unit tests for computer-status-unified-card frontend files.
Covers: _renderUnifiedCard() N/A rendering, DEPT_LABELS mapping,
        computers.html structure, computers.js API endpoint references.
Requirements: 2.7, 3.3, 6.1, 6.2
"""

from __future__ import annotations

import re
from pathlib import Path

COMPUTERS_JS   = Path("frontend/js/computers.js").read_text(encoding="utf-8")
COMPUTERS_HTML = Path("frontend/computers.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Helper: extract DEPT_LABELS from JS source
# ---------------------------------------------------------------------------

def _parse_dept_labels(js_src: str) -> dict[str, str]:
    """Parse the DEPT_LABELS object literal from computers.js source."""
    match = re.search(r"const DEPT_LABELS\s*=\s*\{([^}]+)\}", js_src, re.DOTALL)
    assert match, "DEPT_LABELS not found in computers.js"
    body = match.group(1)
    result: dict[str, str] = {}
    for m in re.finditer(r"(\w+)\s*:\s*'([^']+)'", body):
        result[m.group(1)] = m.group(2)
    return result


# ---------------------------------------------------------------------------
# _renderUnifiedCard — N/A rendering (Requirement 2.7)
# ---------------------------------------------------------------------------

class TestRenderUnifiedCardNullFields:
    """
    Verify that _renderUnifiedCard() outputs 'N/A' for every nullable metric
    when the corresponding field is null/None.

    Strategy: parse the JS function body and check that each null-guard
    branch produces the literal string 'N/A'.
    """

    def _get_function_body(self) -> str:
        match = re.search(
            r"function _renderUnifiedCard\(item\)\s*\{(.+?)^\}",
            COMPUTERS_JS,
            re.DOTALL | re.MULTILINE,
        )
        assert match, "_renderUnifiedCard not found in computers.js"
        return match.group(1)

    def test_memory_use_null_renders_na(self):
        body = self._get_function_body()
        # Should contain: item.memory_use != null ? ... : 'N/A'
        assert re.search(r"item\.memory_use\s*!=\s*null.+?'N/A'", body, re.DOTALL), \
            "memory_use null guard with 'N/A' not found in _renderUnifiedCard"

    def test_load_1_null_renders_na(self):
        body = self._get_function_body()
        assert re.search(r"item\.load_1\s*!=\s*null.+?'N/A'", body, re.DOTALL), \
            "load_1 null guard with 'N/A' not found in _renderUnifiedCard"

    def test_load_5_null_renders_na(self):
        body = self._get_function_body()
        assert re.search(r"item\.load_5\s*!=\s*null.+?'N/A'", body, re.DOTALL), \
            "load_5 null guard with 'N/A' not found in _renderUnifiedCard"

    def test_load_15_null_renders_na(self):
        body = self._get_function_body()
        assert re.search(r"item\.load_15\s*!=\s*null.+?'N/A'", body, re.DOTALL), \
            "load_15 null guard with 'N/A' not found in _renderUnifiedCard"

    def test_disk_used_pct_null_renders_na(self):
        body = self._get_function_body()
        # Disk rows: d.used_pct != null ? ... : 'N/A'
        assert re.search(r"d\.used_pct\s*!=\s*null.+?'N/A'", body, re.DOTALL), \
            "disk used_pct null guard with 'N/A' not found in _renderUnifiedCard"

    def test_na_string_appears_five_times(self):
        """There should be at least 5 'N/A' fallback branches (mem + 3 loads + disk)."""
        body = self._get_function_body()
        count = body.count("'N/A'")
        assert count >= 5, \
            f"Expected at least 5 'N/A' occurrences in _renderUnifiedCard, found {count}"


# ---------------------------------------------------------------------------
# DEPT_LABELS — Chinese label mapping (Requirement 3.3)
# ---------------------------------------------------------------------------

class TestDeptLabels:
    """Verify all five department codes map to the correct Chinese strings."""

    EXPECTED = {
        "wrs":  "氣象雷達科",
        "mrs":  "海象雷達科",
        "sos":  "衛星作業科",
        "dqcs": "品管科",
        "rsa":  "應用科",
    }

    def test_all_five_departments_present(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        for code in self.EXPECTED:
            assert code in labels, f"Department code '{code}' missing from DEPT_LABELS"

    def test_wrs_label(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        assert labels["wrs"] == "氣象雷達科"

    def test_mrs_label(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        assert labels["mrs"] == "海象雷達科"

    def test_sos_label(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        assert labels["sos"] == "衛星作業科"

    def test_dqcs_label(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        assert labels["dqcs"] == "品管科"

    def test_rsa_label(self):
        labels = _parse_dept_labels(COMPUTERS_JS)
        assert labels["rsa"] == "應用科"


# ---------------------------------------------------------------------------
# computers.html — structure (Requirement 6.1)
# ---------------------------------------------------------------------------

class TestComputersHtmlStructure:
    """
    Verify computers.html contains exactly one id="computers-container" element
    and does NOT contain system-container or disk-container.
    """

    def test_computers_container_exists(self):
        assert 'id="computers-container"' in COMPUTERS_HTML, \
            'computers.html must contain id="computers-container"'

    def test_computers_container_appears_exactly_once(self):
        count = COMPUTERS_HTML.count('id="computers-container"')
        assert count == 1, \
            f'Expected exactly 1 id="computers-container", found {count}'

    def test_no_system_container(self):
        assert "system-container" not in COMPUTERS_HTML, \
            "computers.html must NOT contain 'system-container'"

    def test_no_disk_container(self):
        assert "disk-container" not in COMPUTERS_HTML, \
            "computers.html must NOT contain 'disk-container'"


# ---------------------------------------------------------------------------
# computers.js — no legacy API references (Requirement 6.2)
# ---------------------------------------------------------------------------

class TestComputersJsNoLegacyEndpoints:
    """
    Verify computers.js does not reference the old /system/current or
    /disk/current endpoints.
    """

    def test_no_system_current_reference(self):
        assert "/system/current" not in COMPUTERS_JS, \
            "computers.js must NOT reference '/system/current'"

    def test_no_disk_current_reference(self):
        assert "/disk/current" not in COMPUTERS_JS, \
            "computers.js must NOT reference '/disk/current'"
