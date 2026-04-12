from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import get_settings

settings = get_settings()

# ── Singleton client ──────────────────────────────────────────────────────────
_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongo_url)
    return _client


def get_db() -> AsyncIOMotorDatabase:
    global _db
    if _db is None:
        _db = get_client()[settings.db_name]
    return _db


async def close_db():
    global _client
    if _client:
        _client.close()
        _client = None


# ── Collection helpers ────────────────────────────────────────────────────────
# Always exclude MongoDB's internal _id field from results

def col(name: str):
    """Return a collection from the internal database."""
    return get_db()[name]


NO_ID = {"_id": 0}  # Projection to strip _id from all queries
