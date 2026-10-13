"""Employee business rules."""

# Fields safe to return for the current user. Deliberately excludes
# password_hash, the lockout fields (failed_attempts, locked_until), and any
# salary field (none exists yet; this is where it would be filtered).
_PUBLIC_FIELDS = ("id", "email", "name", "role", "created_at", "archived_at")


def public_view(row):
    return {field: row.get(field) for field in _PUBLIC_FIELDS}
