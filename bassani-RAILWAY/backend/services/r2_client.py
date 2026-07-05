import asyncio
import functools
import boto3
from botocore.config import Config
from config import get_settings


def _client():
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.r2_endpoint,
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


async def r2_put(key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
    s = get_settings()
    c = _client()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        functools.partial(c.put_object, Bucket=s.r2_bucket, Key=key, Body=body, ContentType=content_type),
    )


async def r2_delete(key: str) -> None:
    s = get_settings()
    c = _client()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(
        None,
        functools.partial(c.delete_object, Bucket=s.r2_bucket, Key=key),
    )


async def r2_get(key: str) -> bytes:
    """Download an object from R2 and return its raw bytes."""
    s = get_settings()
    c = _client()
    loop = asyncio.get_event_loop()

    def _get():
        resp = c.get_object(Bucket=s.r2_bucket, Key=key)
        return resp["Body"].read()

    return await loop.run_in_executor(None, _get)


async def r2_presign(key: str, expires: int = 3600) -> str:
    s = get_settings()
    c = _client()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        functools.partial(
            c.generate_presigned_url,
            "get_object",
            Params={"Bucket": s.r2_bucket, "Key": key},
            ExpiresIn=expires,
        ),
    )
