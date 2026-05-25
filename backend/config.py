"""
Configuration loader for radar-monitoring-platform.
Loads all settings from config/config.yaml using PyYAML.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import yaml

_CONFIG_PATH = Path(__file__).parent.parent / "config" / "config.yaml"
logger = logging.getLogger("config")


@dataclass
class DatabaseConfig:
    host: str
    port: int
    name: str
    user: str
    password: str
    pool_size: int


@dataclass
class SystemConfig:
    query_timeout_seconds: int
    reconnect_interval_seconds: int
    max_reconnect_attempts: int
    default_threshold_yellow: float
    default_threshold_orange: float
    default_threshold_red: float


@dataclass
class AppConfig:
    databases: Dict[str, DatabaseConfig]
    system: SystemConfig


def _require(mapping: dict, key: str, context: str) -> object:
    if key not in mapping:
        raise KeyError(f"Missing required config field '{key}' in {context}")
    return mapping[key]


def _parse_database(data: dict, name: str) -> DatabaseConfig:
    ctx = f"databases.{name}"
    return DatabaseConfig(
        host=str(_require(data, "host", ctx)),
        port=int(_require(data, "port", ctx)),
        name=str(_require(data, "name", ctx)),
        user=str(_require(data, "user", ctx)),
        password=str(_require(data, "password", ctx)),
        pool_size=int(_require(data, "pool_size", ctx)),
    )


def _parse_system(data: dict) -> SystemConfig:
    return SystemConfig(
        query_timeout_seconds=int(_require(data, "query_timeout_seconds", "system")),
        reconnect_interval_seconds=int(_require(data, "reconnect_interval_seconds", "system")),
        max_reconnect_attempts=int(_require(data, "max_reconnect_attempts", "system")),
        default_threshold_yellow=float(data.get("default_threshold_yellow", 10.0)),
        default_threshold_orange=float(data.get("default_threshold_orange", 15.0)),
        default_threshold_red=float(data.get("default_threshold_red", 20.0)),
    )


def _load_config(path: Path = _CONFIG_PATH) -> AppConfig:
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with path.open("r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        raise ValueError("config.yaml must be a YAML mapping at the top level")

    db_raw = _require(raw, "databases", "root")
    databases: Dict[str, DatabaseConfig] = {}
    for db_name in ("file_status", "system_status", "disk_status"):
        if db_name not in db_raw:
            raise KeyError(f"Missing required database config: databases.{db_name}")
        databases[db_name] = _parse_database(db_raw[db_name], db_name)

    system = _parse_system(_require(raw, "system", "root"))
    return AppConfig(databases=databases, system=system)


_config: AppConfig | None = None


def get_config() -> AppConfig:
    global _config
    if _config is None:
        _config = _load_config()
    return _config
