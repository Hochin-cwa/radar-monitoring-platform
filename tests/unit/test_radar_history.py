"""Unit tests for rb5 / nexrad file-name parsing and satellite table whitelist."""
from datetime import datetime

import pytest

from backend.services import history_service as h


@pytest.mark.parametrize("name,expected", [
    ("/data/rclydata/x.vol/2026-11-18/2026111807361200dBZv.vol", (datetime(2026, 11, 18, 7, 36, 12), "dBZv")),
    ("/data/rchldata/2026-11-18/2026111807421200uPhiDP.vol.gz", (datetime(2026, 11, 18, 7, 42, 12), "uPhiDP")),
    ("/home/data/rb5_rcckdata/ROCAF_CDD.vol/2026111807282000W.vol", (datetime(2026, 11, 18, 7, 28, 20), "W")),
])
def test_parse_rb5_filename(name, expected):
    assert h._parse_rb5_filename(name) == expected


def test_parse_rb5_filename_rejects_non_vol():
    assert h._parse_rb5_filename("/a/RCAY_20261118_074500.msg31.gz") is None


@pytest.mark.parametrize("name,expected", [
    ("/d/RCAY_20261118_074500.msg31.gz", datetime(2026, 11, 18, 7, 45, 0)),
    ("/d/20261118074200.raw.gz", datetime(2026, 11, 18, 7, 42, 0)),
    ("/d/2026_1118/20261118_0741_RCWF_VOL.450", datetime(2026, 11, 18, 7, 41, 0)),
])
def test_parse_nexrad_filename(name, expected):
    assert h._parse_nexrad_filename(name) == expected


def test_radar_format():
    assert h.radar_format_for_file_type("RCNT_rb5_SUB-3") == "rb5"
    assert h.radar_format_for_file_type("RCCG_nexrad_mod") == "nexrad"
    assert h.radar_format_for_file_type("RCLY_eclass") is None


def test_satellite_tables():
    assert h.satellite_table_for_file_type("HIMA_TP") == "satelliteHima_TP"
    assert h.satellite_table_for_file_type("HIMA_TN") == "satelliteHima_TN"
    assert h.satellite_table_for_file_type("GK2A_XW") == "satelliteGK2A_XW"
    assert h.satellite_table_for_file_type("HIMA_WEB_VIS") is None
