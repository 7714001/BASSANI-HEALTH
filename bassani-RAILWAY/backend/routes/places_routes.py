"""
Google Places API proxy — address autocomplete for the customer onboarding forms.

Public endpoints (no auth — used on the /apply public form and the reseller
onboarding wizard):
  GET /api/public/places/autocomplete?q=&session_token=
  GET /api/public/places/details?place_id=&session_token=

The Google API key lives in the GOOGLE_PLACES_API_KEY Railway env var and is
never exposed to the browser. Session tokens group each autocomplete+details
pair into a single billing transaction per Google's recommendation.

Rate limited: 60 requests / hour / IP on both endpoints.
"""
import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from config import get_settings
from rate_limit import limiter

router = APIRouter(prefix="/api/public/places", tags=["places"])

_AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
_DETAILS_URL      = "https://maps.googleapis.com/maps/api/place/details/json"


def _key() -> str:
    k = get_settings().google_places_api_key
    if not k:
        raise HTTPException(status_code=503, detail="Address lookup not configured")
    return k


def _extract(components: list[dict]) -> dict:
    """Map Google address_components list to our flat address schema."""
    def get(types: list[str]) -> str:
        for c in components:
            if any(t in c.get("types", []) for t in types):
                return c.get("long_name", "")
        return ""

    street_number = get(["street_number"])
    route         = get(["route"])
    street        = f"{street_number} {route}".strip() if street_number else route

    return {
        "street":      street,
        "suburb":      get(["sublocality_level_1", "sublocality"]),
        "city":        get(["locality"]),
        "province":    get(["administrative_area_level_1"]),
        "postal_code": get(["postal_code"]),
    }


@router.get("/autocomplete")
@limiter.limit("60/hour")
async def autocomplete(
    request:       Request,
    q:             str = Query(""),
    session_token: str = Query(""),
):
    if len(q.strip()) < 2:
        return {"predictions": []}

    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(_AUTOCOMPLETE_URL, params={
            "input":        q,
            "components":   "country:za",
            "types":        "address",
            "sessiontoken": session_token,
            "key":          _key(),
        })

    data = r.json()
    status = data.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        raise HTTPException(status_code=502, detail=f"Places API error: {status}")

    return {
        "predictions": [
            {"description": p["description"], "place_id": p["place_id"]}
            for p in data.get("predictions", [])
        ]
    }


@router.get("/details")
@limiter.limit("60/hour")
async def details(
    request:       Request,
    place_id:      str = Query(...),
    session_token: str = Query(""),
):
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(_DETAILS_URL, params={
            "place_id":     place_id,
            "fields":       "address_components",
            "sessiontoken": session_token,
            "key":          _key(),
        })

    data = r.json()
    if data.get("status") != "OK":
        raise HTTPException(status_code=502, detail=f"Places API error: {data.get('status')}")

    components = data.get("result", {}).get("address_components", [])
    return _extract(components)
