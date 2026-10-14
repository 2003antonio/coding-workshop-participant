"""Calendar weeks: ISO weeks, Monday to Sunday, each identified by its Monday.

An allocation counts its full hours in every week its date range touches,
even a partial week (docs/api-contract.md section 1).
"""

import datetime


def week_start(day: datetime.date) -> datetime.date:
    """The Monday of the ISO week that contains `day`."""
    return day - datetime.timedelta(days=day.weekday())


def weeks_touched(start: datetime.date, end: datetime.date) -> list:
    """Mondays of every week the range start..end (inclusive) touches; [] if start > end."""
    monday, last = week_start(start), week_start(end)
    weeks = []
    while monday <= last:
        weeks.append(monday)
        monday += datetime.timedelta(days=7)
    return weeks


def count_weeks(start: datetime.date, end: datetime.date) -> int:
    """How many weeks the range start..end touches; 0 if start > end."""
    if start > end:
        return 0
    return (week_start(end) - week_start(start)).days // 7 + 1


def today() -> datetime.date:
    """Today's date (UTC in Lambda). Services call this so tests can fix the date."""
    return datetime.date.today()
