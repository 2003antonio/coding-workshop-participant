"""Load one backend service's modules without clashing with another's. LOCAL USE ONLY.

Every service has top-level modules with the same names (function, routes,
services, repository), because in AWS each runs alone in its own Lambda. In one
Python process (dev_server.py, or pytest running every test folder) a second
`import routes` would silently return the FIRST service's routes.

load_service() imports a service with those names cleared, keeps the module
objects it got, then puts the names back exactly as they were. The modules hold
direct references to each other (function -> routes -> services -> repository),
so each service keeps using its own files. `common` is imported once from
backend/common and shared, as in production.
"""

import importlib
import os
import sys
import types

_BACKEND = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

# The per-service module names that collide between services.
SERVICE_MODULES = ("function", "routes", "services", "repository")


def load_service(name: str) -> types.SimpleNamespace:
    """Import backend/<name>/function.py and its sibling modules in isolation.

    Returns:
        A namespace with attributes function, routes, services, repository.
    """
    service_dir = os.path.join(_BACKEND, name)
    if not os.path.isfile(os.path.join(service_dir, "function.py")):
        raise ValueError(f"No such service: {name!r}")

    # Import shared code (and its third-party packages) from backend/ first, so a
    # copy vendored into the service folder by start-dev.sh is never picked up.
    if _BACKEND not in sys.path:
        sys.path.insert(0, _BACKEND)
    importlib.import_module("common.auth")
    importlib.import_module("common.db")

    saved = {mod: sys.modules.pop(mod) for mod in SERVICE_MODULES if mod in sys.modules}
    sys.path.insert(0, service_dir)
    try:
        importlib.import_module("function")
        loaded = {mod: sys.modules[mod] for mod in SERVICE_MODULES if mod in sys.modules}
    finally:
        sys.path.remove(service_dir)
        for mod in SERVICE_MODULES:
            sys.modules.pop(mod, None)
        sys.modules.update(saved)
    return types.SimpleNamespace(**loaded)
