"""One consistent error shape for the whole API.

Every failure is an ApiError (or subclass). The response layer renders it as:

    {"error": {"code": "<machine_code>", "message": "<human message>"}}

Messages are safe to show clients; nothing sensitive goes in them.
"""


class ApiError(Exception):
    status_code = 500
    code = "internal_error"
    message = "Internal server error."

    def __init__(self, message=None, code=None, status_code=None):
        self.message = message or self.message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message)

    def to_dict(self):
        return {"error": {"code": self.code, "message": self.message}}


class BadRequest(ApiError):
    status_code = 400
    code = "bad_request"
    message = "Bad request."


class Unauthorized(ApiError):
    status_code = 401
    code = "unauthorized"
    message = "Authentication required."


class Forbidden(ApiError):
    status_code = 403
    code = "forbidden"
    message = "You do not have permission to do that."


class NotFound(ApiError):
    status_code = 404
    code = "not_found"
    message = "Not found."


class Conflict(ApiError):
    status_code = 409
    code = "conflict"
    message = "That conflicts with the current state."
