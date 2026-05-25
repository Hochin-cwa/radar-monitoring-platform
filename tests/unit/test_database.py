"""
Unit tests for backend/database.py
Covers: get_engine lazy init, invalid db_name, get_session, check_connection retry logic.
"""

from __future__ import annotations

import pytest
from unittest.mock import MagicMock, patch, call
from sqlalchemy.exc import OperationalError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_op_error() -> OperationalError:
    return OperationalError("connection refused", None, None)


# ---------------------------------------------------------------------------
# get_engine
# ---------------------------------------------------------------------------

class TestGetEngine:
    def test_returns_engine_for_valid_db(self):
        import backend.database as db_module
        # Clear cached engines so we get a fresh init
        db_module._engines.clear()
        db_module._session_factories.clear()

        engine = db_module.get_engine("file_status")
        assert engine is not None

    def test_same_engine_returned_on_second_call(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        e1 = db_module.get_engine("system_status")
        e2 = db_module.get_engine("system_status")
        assert e1 is e2

    def test_raises_for_unknown_db_name(self):
        import backend.database as db_module
        with pytest.raises(ValueError, match="Unknown db_name"):
            db_module.get_engine("nonexistent_db")


# ---------------------------------------------------------------------------
# get_session
# ---------------------------------------------------------------------------

class TestGetSession:
    def test_raises_for_unknown_db_name(self):
        import backend.database as db_module
        with pytest.raises(ValueError, match="Unknown db_name"):
            with db_module.get_session("bad_db"):
                pass

    def test_session_commits_on_success(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_session = MagicMock()
        mock_factory = MagicMock(return_value=mock_session)
        db_module._session_factories["disk_status"] = mock_factory
        # Ensure engine entry exists so _init_engine is not called
        db_module._engines["disk_status"] = MagicMock()

        with db_module.get_session("disk_status") as s:
            assert s is mock_session

        mock_session.commit.assert_called_once()
        mock_session.close.assert_called_once()

    def test_session_rolls_back_on_exception(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_session = MagicMock()
        mock_factory = MagicMock(return_value=mock_session)
        db_module._session_factories["disk_status"] = mock_factory
        db_module._engines["disk_status"] = MagicMock()

        with pytest.raises(RuntimeError):
            with db_module.get_session("disk_status"):
                raise RuntimeError("boom")

        mock_session.rollback.assert_called_once()
        mock_session.close.assert_called_once()


# ---------------------------------------------------------------------------
# check_connection — retry logic (requirements 6.4, 6.5)
# ---------------------------------------------------------------------------

class TestCheckConnection:
    def test_returns_true_on_first_success(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_engine = MagicMock()
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)
        db_module._engines["file_status"] = mock_engine

        result = db_module.check_connection("file_status")
        assert result is True

    def test_retries_up_to_max_attempts_then_returns_false(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_engine = MagicMock()
        mock_engine.connect.side_effect = _make_op_error()
        db_module._engines["file_status"] = mock_engine

        with patch("backend.database.time.sleep") as mock_sleep:
            result = db_module.check_connection("file_status")

        assert result is False
        # 3 attempts → 2 sleeps between them
        assert mock_engine.connect.call_count == 3
        assert mock_sleep.call_count == 2

    def test_sleep_interval_matches_config(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_engine = MagicMock()
        mock_engine.connect.side_effect = _make_op_error()
        db_module._engines["system_status"] = mock_engine

        with patch("backend.database.time.sleep") as mock_sleep:
            db_module.check_connection("system_status")

        from backend.config import get_config
        expected_interval = get_config().system.reconnect_interval_seconds
        for c in mock_sleep.call_args_list:
            assert c == call(expected_interval)

    def test_succeeds_on_second_attempt(self):
        import backend.database as db_module
        db_module._engines.clear()
        db_module._session_factories.clear()

        mock_engine = MagicMock()
        # First call raises, second succeeds
        mock_conn = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_engine.connect.side_effect = [_make_op_error(), mock_conn]
        db_module._engines["disk_status"] = mock_engine

        with patch("backend.database.time.sleep"):
            result = db_module.check_connection("disk_status")

        assert result is True
        assert mock_engine.connect.call_count == 2

    def test_raises_for_unknown_db_name(self):
        import backend.database as db_module
        with pytest.raises(ValueError, match="Unknown db_name"):
            db_module.check_connection("unknown")
