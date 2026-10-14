"""Build Lambda Function URL responses with the correct HTTP status codes.

CORS headers are added by the Function URL (AWS) and the dev proxy (local), so
we do not set them here.
"""

import json

from common.errors import ApiError

_JSON_HEADERS = {"Content-Type": "application/json"}


def json_response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": _JSON_HEADERS,
        # default=str serialises datetimes/dates/UUIDs returned by the DB.
        "body": json.dumps(body, default=str),
    }


def ok(body):
    return json_response(200, body)


def created(body):
    return json_response(201, body)


def no_content():
    # 204 carries no body.
    return {"statusCode": 204, "headers": _JSON_HEADERS, "body": ""}


def error(api_error: ApiError):
    return json_response(api_error.status_code, api_error.to_dict())
