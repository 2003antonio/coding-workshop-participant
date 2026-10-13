"""Auth routes: request parsing, then hand off to services, then response."""

from auth import services
from common import responses, validation


def login(body, headers):
    data = validation.require_dict(body)
    email = validation.require_email(data, "email")
    password = validation.require_str(data, "password")
    return responses.ok(services.login(email, password))


def refresh(body, headers):
    data = validation.require_dict(body)
    token = validation.require_str(data, "refresh_token")
    return responses.ok(services.refresh(token))


def logout(body, headers):
    data = validation.require_dict(body)
    token = validation.require_str(data, "refresh_token")
    services.logout(token)
    return responses.no_content()
