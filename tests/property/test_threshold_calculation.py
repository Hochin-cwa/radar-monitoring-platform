"""
Property-based tests for threshold auto-calculation logic.

Feature: radar-monitoring-platform
Requirement 5: 儀器時間差閾值管理
"""
from __future__ import annotations

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.services.alert_service import calculate_thresholds

# Feature: radar-monitoring-platform, Property 1: for any interval_minutes > 0,
# threshold_yellow = interval_minutes + 5, threshold_orange = interval_minutes + 10,
# threshold_red = interval_minutes + 20
# Validates: Requirements 5


@settings(max_examples=100)
@given(interval_minutes=st.floats(min_value=0.001, max_value=10_000.0, allow_nan=False, allow_infinity=False))
def test_threshold_calculation_property(interval_minutes: float) -> None:
    """Property 1: threshold values are always T+5, T+10, T+20 for any T > 0."""
    yellow, orange, red = calculate_thresholds(interval_minutes)

    assert yellow == interval_minutes + 5.0, (
        f"yellow threshold should be T+5: got {yellow}, expected {interval_minutes + 5.0}"
    )
    assert orange == interval_minutes + 10.0, (
        f"orange threshold should be T+10: got {orange}, expected {interval_minutes + 10.0}"
    )
    assert red == interval_minutes + 20.0, (
        f"red threshold should be T+20: got {red}, expected {interval_minutes + 20.0}"
    )


@settings(max_examples=100)
@given(interval_minutes=st.floats(min_value=0.001, max_value=10_000.0, allow_nan=False, allow_infinity=False))
def test_threshold_ordering_property(interval_minutes: float) -> None:
    """Property 1 (ordering): yellow < orange < red for any T > 0."""
    yellow, orange, red = calculate_thresholds(interval_minutes)

    assert yellow < orange < red, (
        f"Expected yellow < orange < red, got {yellow} < {orange} < {red}"
    )


def test_threshold_defaults() -> None:
    """Verify default T=7 produces yellow=12, orange=17, red=27 as per requirements."""
    yellow, orange, red = calculate_thresholds(7.0)
    assert yellow == 12.0
    assert orange == 17.0
    assert red == 27.0
