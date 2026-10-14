"""Money rules shared by the teams, projects and reports services.

Only an admin ever sees an individual salary or hourly rate. Totals over a
small group could still reveal one person's pay, so a non-admin gets every
money field as null when the group (active team members, or distinct people
allocated to a project) is smaller than MIN_AGGREGATE_GROUP.

Amounts are computed with Decimal at full precision; only the final totals
are rounded to 2 decimals (half up) when shown.
"""

import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from common import weeks

# The one place the minimum group size is defined.
MIN_AGGREGATE_GROUP = 3
HIDDEN_REASON = "below_min_group"

HOURS_PER_YEAR = Decimal(2080)
WEEKS_PER_YEAR = Decimal(52)
_CENT = Decimal("0.01")


def is_hidden(viewer_role: str, group_size: int) -> bool:
    """True when a non-admin must not see money for a group of this size."""
    return viewer_role != "admin" and group_size < MIN_AGGREGATE_GROUP


def hidden_reason(hidden: bool) -> Optional[str]:
    return HIDDEN_REASON if hidden else None


def money(amount: Optional[Decimal]) -> Optional[float]:
    """Round to cents (half up) for the JSON response; None stays None."""
    if amount is None:
        return None
    return float(Decimal(amount).quantize(_CENT, rounding=ROUND_HALF_UP))


def hourly_rate(salary: Decimal) -> Decimal:
    """Annual salary / 2080, unrounded."""
    return Decimal(salary) / HOURS_PER_YEAR


def team_budget(salaries: list) -> dict:
    """Yearly and weekly cost of a team's members (unrounded Decimals)."""
    yearly = sum((Decimal(s) for s in salaries), Decimal(0))
    return {"yearly": yearly, "weekly": yearly / WEEKS_PER_YEAR}


def allocation_cost(hours_per_week: int, salary: Decimal, start: datetime.date,
                    end: datetime.date, today: datetime.date) -> dict:
    """Planned and used cost of one allocation (unrounded Decimals).

    planned covers every week the range touches; used covers those weeks up
    to and including the week that contains `today`.
    """
    weekly = Decimal(hours_per_week) * hourly_rate(salary)
    total_weeks = weeks.count_weeks(start, end)
    used_weeks = weeks.count_weeks(start, min(end, weeks.week_start(today) + datetime.timedelta(days=6)))
    return {"weeks": total_weeks, "weekly": weekly,
            "planned": weekly * total_weeks, "used": weekly * used_weeks}


def percent_of_budget(used: Decimal, planned_budget: Optional[Decimal]) -> Optional[float]:
    """used / planned budget as a percentage (one decimal, may exceed 100);
    None when no planned budget is set or it is 0."""
    if not planned_budget:
        return None
    return percent(used, planned_budget)


def over_budget(committed: Decimal, planned_budget: Optional[Decimal]) -> Optional[bool]:
    """Committed cost above the planned budget; None when no planned budget is set."""
    if planned_budget is None:
        return None
    return Decimal(committed) > Decimal(planned_budget)


def percent(part: Decimal, whole: Decimal) -> float:
    """part / whole as a percentage with one decimal; 0 when whole is 0."""
    if not whole:
        return 0.0
    return float((Decimal(part) * 100 / Decimal(whole)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))
