"""Shared rate limiter instance — imported by server.py (to register the
exception handler) and by any route that needs a @limiter.limit(...) decorator.
Kept in its own module to avoid a circular import with server.py."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
