"""Unit tests for the role checks in backend/common/rbac.py (no database)."""

import pytest

from common import rbac
from common.errors import Forbidden, Unauthorized


def _emp(role):
    return {"id": "00000000-0000-0000-0000-000000000001", "role": role}


# Every (role, min_role) pair with the answer written out by hand, so a wrong
# ROLE_ORDER (e.g. manager above admin) fails here instead of being re-derived.
@pytest.mark.parametrize("role, min_role, allowed", [
    ("employee", "employee", True),
    ("employee", "manager", False),
    ("employee", "admin", False),
    ("manager", "employee", True),
    ("manager", "manager", True),
    ("manager", "admin", False),
    ("admin", "employee", True),
    ("admin", "manager", True),
    ("admin", "admin", True),
])
def test_require_min_role_follows_employee_manager_admin_order(role, min_role, allowed):
    if allowed:
        assert rbac.require_min_role(_emp(role), min_role) == role
    else:
        with pytest.raises(Forbidden):
            rbac.require_min_role(_emp(role), min_role)


def test_role_order_lists_exactly_the_valid_roles():
    assert sorted(rbac.ROLE_ORDER) == sorted(rbac.VALID_ROLES)


@pytest.mark.parametrize("employee", [None, {}, "admin", ["admin"]])
def test_require_min_role_without_an_employee_is_401(employee):
    with pytest.raises(Unauthorized):
        rbac.require_min_role(employee, "employee")


@pytest.mark.parametrize("role", [None, "", "superuser", "Admin", " admin"])
def test_require_min_role_denies_unknown_roles(role):
    with pytest.raises(Forbidden):
        rbac.require_min_role(_emp(role), "employee")


@pytest.mark.parametrize("min_role", ["", "superuser", "Manager", None])
def test_require_min_role_rejects_an_unknown_minimum_as_a_bug(min_role):
    # A typo in a route must fail loudly, never quietly allow or deny.
    with pytest.raises(ValueError):
        rbac.require_min_role(_emp("admin"), min_role)


# require_role is unchanged: an explicit allow-list, deny by default.
def test_require_role_allows_only_listed_roles():
    assert rbac.require_role(_emp("manager"), "admin", "manager") == "manager"
    with pytest.raises(Forbidden):
        rbac.require_role(_emp("employee"), "admin", "manager")
    with pytest.raises(Forbidden):
        rbac.require_role(_emp("admin"))  # empty allow-list
    with pytest.raises(Unauthorized):
        rbac.require_role(None, "admin")
