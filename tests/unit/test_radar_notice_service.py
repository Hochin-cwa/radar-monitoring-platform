"""radar_notice_service 解析測試（不連外）。"""
from backend.services.radar_notice_service import parse_radar_notices

SAMPLE = """var Radar_News={
  'C':{
    'title_str':"本署樹林雷達站因年度保養，自2026年11月17日08時30分至2026年11月19日17時00分不定時停止觀測。<br />本署七股雷達站因維護保養，自2026年11月18日09時00分至2026年11月18日12時00分不定時停止觀測。<br />",
    'title_html':"x"
  },
  'E':{'title_str':"The Shulin ..."},
};
"""


def test_parse_two_notices():
    n = parse_radar_notices(SAMPLE)
    assert [x["station"] for x in n] == ["樹林", "七股"]
    assert "年度保養" in n[0]["message"] and "<br" not in n[0]["message"]


def test_parse_empty_and_garbage():
    assert parse_radar_notices("") == []
    assert parse_radar_notices("var Radar_News={'C':{'title_str':\"\"}};") == []
