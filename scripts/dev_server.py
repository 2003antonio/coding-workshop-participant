"""Tiny local HTTP server for the backend Lambdas. LOCAL USE ONLY.

Turns each HTTP request into a Lambda Function URL-shaped event and calls the
handler of the service named in the URL (/api/auth/... -> backend/auth,
/api/teams/... -> backend/teams, and so on for every name in SERVICE_NAMES),
with CORS for the React dev server.
Each service is loaded in isolation (see service_loader.py) because they all
have modules named routes, services and repository.
Binds to 127.0.0.1 only. One thread per connection, so a browser's idle
pre-opened sockets cannot block real requests; each request uses its own DB
connection, closed when it finishes (like separate Lambda instances).
Uses backend/common directly, so no sync step is needed.
Shares port 3001 with bin/proxy-server.js: run one or the other.

Usage (repo root):
    .venv/Scripts/python.exe scripts/dev_server.py      (Windows)
    .venv/bin/python scripts/dev_server.py              (Linux / macOS)
"""

import base64
import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional
from urllib.parse import urlsplit

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", "backend"))
sys.path[0:0] = [_HERE, _BACKEND]

from local_env import load_local_env  # noqa: E402
from service_loader import load_service  # noqa: E402
from common import db  # noqa: E402

PORT = 3001
SERVICE_NAMES = ("auth", "employees", "teams", "projects", "allocations", "reports")
# The React dev server: Vite's default port, and the port in frontend/vite.config.js.
ALLOWED_ORIGINS = frozenset({"http://localhost:5173", "http://localhost:3000"})
ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
_MAX_READ_BYTES = 1024 * 1024  # the handler enforces the real 64 KB limit

# Filled by main(): {"auth": <auth function module>, "employees": ..., ...}.
HANDLERS: dict = {}

_UNKNOWN_SERVICE = {"statusCode": 404, "headers": {"Content-Type": "application/json"},
                    "body": json.dumps({"error": {"code": "not_found",
                                                  "message": "Unknown route."}})}


def service_for(path: str) -> Optional[str]:
    """Return the service named by /api/<service>[/...], or None."""
    for name in SERVICE_NAMES:
        prefix = f"/api/{name}"
        if path == prefix or path.startswith(prefix + "/"):
            return name
    return None


def load_handlers() -> dict:
    """Load every service in isolation; returns {name: its function module}."""
    return {name: load_service(name).function for name in SERVICE_NAMES}


class _Handler(BaseHTTPRequestHandler):
    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", ALLOWED_METHODS)
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")

    def do_OPTIONS(self) -> None:  # noqa: N802 (http.server naming)
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _forward(self) -> None:
        url = urlsplit(self.path)
        length = min(int(self.headers.get("Content-Length") or 0), _MAX_READ_BYTES)
        raw = self.rfile.read(length) if length else b""
        try:
            body, is_b64 = raw.decode("utf-8"), False
        except UnicodeDecodeError:
            body, is_b64 = base64.b64encode(raw).decode("ascii"), True
        event = {
            "version": "2.0",
            "rawPath": url.path,
            "rawQueryString": url.query,
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "requestContext": {"http": {"method": self.command, "path": url.path,
                                        "sourceIp": self.client_address[0]}},
            "body": body or None,
            "isBase64Encoded": is_b64,
        }
        function = HANDLERS.get(service_for(url.path))
        try:
            result = function.handler(event, None) if function else _UNKNOWN_SERVICE
        finally:
            db.close()  # this thread is done; do not leak its connection
        payload = (result.get("body") or "").encode("utf-8")
        self.send_response(result["statusCode"])
        for name, value in (result.get("headers") or {}).items():
            self.send_header(name, value)
        self._cors_headers()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_GET = _forward  # noqa: N815
    do_POST = _forward  # noqa: N815
    do_PUT = _forward  # noqa: N815
    do_PATCH = _forward  # noqa: N815
    do_DELETE = _forward  # noqa: N815

    def log_message(self, format: str, *args: object) -> None:
        pass  # the Lambda handler already logs method, route, status and actor


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    load_local_env()  # before any request opens a DB connection
    HANDLERS.update(load_handlers())
    server = ThreadingHTTPServer(("127.0.0.1", PORT), _Handler)
    server.daemon_threads = True  # Ctrl+C never waits on idle browser connections
    for name in SERVICE_NAMES:
        print(f"  {name:<10} http://127.0.0.1:{PORT}/api/{name}/")
    print("Dev server running (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
