"""Unit tests for common/weeks.py and common/budget.py (no database)."""

import datetime
from decimal import Decimal

import pytest

from common import budget, weeks

D = datetime.date


# =====================================================================
# Weeks
# =====================================================================
@pytest.mark.parametrize("day, monday", [
    (D(2026, 11, 2), D(2026, 11, 2)),    # Monday
    (D(2026, 11, 8), D(2026, 11, 2)),    # Sunday
    (D(2027, 1, 1), D(2026, 12, 28)),    # across the new year
])
def test_week_start_is_the_monday(day, monday):
    assert weeks.week_start(day) == monday


def test_a_partial_week_counts_as_a_whole_week():
    # Sunday to Monday touches two weeks.
    assert weeks.weeks_touched(D(2026, 11, 8), D(2026, 11, 9)) == [D(2026, 11, 2), D(2026, 11, 9)]
    assert weeks.count_weeks(D(2026, 11, 8), D(2026, 11, 9)) == 2


def test_one_day_is_one_week_and_a_reversed_range_is_none():
    assert weeks.count_weeks(D(2026, 11, 4), D(2026, 11, 4)) == 1
    assert weeks.weeks_touched(D(2026, 11, 9), D(2026, 11, 2)) == []
    assert weeks.count_weeks(D(2026, 11, 9), D(2026, 11, 2)) == 0


def test_count_and_list_agree_over_a_long_range():
    start, end = D(2026, 1, 1), D(2026, 12, 31)
    assert weeks.count_weeks(start, end) == len(weeks.weeks_touched(start, end)) == 53


# =====================================================================
# Budget
# =====================================================================
def test_min_aggregate_group_is_three():
    # The contract fixes this value; changing it is a contract change.
    assert budget.MIN_AGGREGATE_GROUP == 3


@pytest.mark.parametrize("role, size, hidden", [
    ("manager", 2, True), ("manager", 3, False), ("employee", 0, True),
    ("admin", 0, False), ("admin", 1, False),
])
def test_only_non_admins_below_the_minimum_are_hidden(role, size, hidden):
    assert budget.is_hidden(role, size) is hidden
    assert budget.hidden_reason(hidden) == ("below_min_group" if hidden else None)


def test_rates_are_computed_at_full_precision_and_only_totals_rounded():
    # The contract example: 110000 / 2080 = 52.8846..., 20 h x 7 weeks.
    cost = budget.allocation_cost(20, Decimal("110000"), D(2026, 11, 2), D(2026, 12, 18),
                                  today=D(2026, 11, 10))
    assert cost["weeks"] == 7
    assert budget.money(budget.hourly_rate(Decimal("110000"))) == 52.88
    assert budget.money(cost["planned"]) == 7403.85        # not 52.88 x 140 = 7403.20
    assert budget.money(cost["used"]) == 2115.38           # two weeks so far


def test_used_is_zero_before_the_start_and_everything_after_the_end():
    before = budget.allocation_cost(10, Decimal(2080), D(2026, 11, 2), D(2026, 11, 20),
                                    today=D(2026, 10, 1))
    after = budget.allocation_cost(10, Decimal(2080), D(2026, 11, 2), D(2026, 11, 20),
                                   today=D(2027, 1, 1))
    assert before["used"] == 0 and before["planned"] == 30
    assert after["used"] == after["planned"] == 30


def test_team_budget_weekly_is_yearly_over_52():
    result = budget.team_budget([Decimal("125000"), Decimal("125000"), Decimal("125000")])
    assert budget.money(result["yearly"]) == 375000.00
    assert budget.money(result["weekly"]) == 7211.54
    assert budget.team_budget([]) == {"yearly": 0, "weekly": 0}


def test_money_rounds_half_up_and_keeps_none():
    assert budget.money(Decimal("0.005")) == 0.01
    assert budget.money(None) is None


def test_percent():
    assert budget.percent(Decimal(1), Decimal(3)) == 33.3
    assert budget.percent(Decimal(5), Decimal(0)) == 0.0
