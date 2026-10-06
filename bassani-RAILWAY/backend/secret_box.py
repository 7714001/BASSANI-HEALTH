"""Encryption at rest for third-party credentials the portal stores and must
use again later (Phase 14: WooCommerce consumer secrets, webhook secrets).

Different from API keys (external_auth.py), which are only ever *verified*
and so are stored as one-way SHA-256 hashes. A credential the portal has to
send to someone else's system must be recoverable, so it is encrypted with
Fernet (AES-128-CBC + HMAC-SHA256, from the `cryptography` package).

The Fernet key is derived from the CREDENTIALS_ENCRYPTION_KEY env var (any
long random string — SHA-256 → urlsafe base64), so Railway only needs a
plain secret, not a correctly formatted Fernet key. If the variable is
unset, encrypt() refuses outright rather than falling back to storing the
secret in plain text. Changing the variable makes every stored secret
unreadable — re-enter them after rotating it.
"""
import base64
import hashlib
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

from config import get_settings


class SecretBoxNotConfigured(RuntimeError):
    pass


def _fernet() -> Fernet:
    raw = get_settings().credentials_encryption_key
    if not raw:
        raise SecretBoxNotConfigured(
            "CREDENTIALS_ENCRYPTION_KEY is not set, so credentials cannot be stored securely."
        )
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(raw.encode()).digest()))


def is_configured() -> bool:
    return bool(get_settings().credentials_encryption_key)


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: Optional[str]) -> Optional[str]:
    """Returns None for an empty value or one that can't be decrypted (e.g.
    after the encryption key was rotated) — callers treat that as "not set"."""
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, SecretBoxNotConfigured):
        return None
