"""
SQLAlchemy connection pool management for radar-monitoring-platform.
Manages three independent connection pools: file_status, system_status, disk_status.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Dict, Generator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from backend.config import get_config

logger = logging.getLogger("database")

_VALID_DB_NAMES = ("file_status", "system_status", "disk_status")

# Module-level engine registry — lazy-initialized on first access
_engines: Dict[str, Engine] = {}
_session_factories: Dict[str, sessionmaker] = {}


def _build_url(db_name: str) -> str:
    cfg = get_config().databases[db_name]
    return (
        f"mysql+pymysql://{cfg.user}:{cfg.password}"
        f"@{cfg.host}:{cfg.port}/{cfg.name}"
    )


def _init_engine(db_name: str) -> Engine:
    """Create and register the SQLAlchemy engine for db_name."""
    cfg = get_config().databases[db_name]
    url = _build_url(db_name)
    engine = create_engine(
        url,
        pool_size=cfg.pool_size,
        pool_pre_ping=True,
    )
    _engines[db_name] = engine
    _session_factories[db_name] = sessionmaker(bind=engine)
    logger.info("Engine initialised for database '%s'", db_name)
    return engine


def _validate_db_name(db_name: str) -> None:
    if db_name not in _VALID_DB_NAMES:
        raise ValueError(
            f"Unknown db_name '{db_name}'. Must be one of {_VALID_DB_NAMES}."
        )


def get_engine(db_name: str) -> Engine:
    """Return the SQLAlchemy Engine for the given database, initialising it lazily."""
    _validate_db_name(db_name)
    if db_name not in _engines:
        _init_engine(db_name)
    return _engines[db_name]


@contextmanager
def get_session(db_name: str) -> Generator[Session, None, None]:
    """Context manager that yields a SQLAlchemy Session for the given database."""
    _validate_db_name(db_name)
    if db_name not in _session_factories:
        _init_engine(db_name)
    factory = _session_factories[db_name]
    session: Session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_connection(db_name: str) -> bool:
    """
    Attempt to connect to the database, retrying up to max_reconnect_attempts times
    with reconnect_interval_seconds between attempts.

    Returns True if connection succeeds, False if all attempts fail.
    Logs an ERROR after all retries are exhausted.
    """
    _validate_db_name(db_name)
    sys_cfg = get_config().system
    max_attempts: int = sys_cfg.max_reconnect_attempts
    interval: int = sys_cfg.reconnect_interval_seconds

    engine = get_engine(db_name)

    for attempt in range(1, max_attempts + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info(
                "Connection check succeeded for database '%s' (attempt %d/%d)",
                db_name, attempt, max_attempts,
            )
            return True
        except (OperationalError, SQLAlchemyError) as exc:
            logger.warning(
                "Connection check failed for database '%s' (attempt %d/%d): %s",
                db_name, attempt, max_attempts, exc,
            )
            if attempt < max_attempts:
                logger.info(
                    "Retrying connection to '%s' in %d seconds…",
                    db_name, interval,
                )
                time.sleep(interval)

    logger.error(
        "All %d connection attempts failed for database '%s'. Giving up.",
        max_attempts, db_name,
    )
    return False
