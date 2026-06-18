from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from auth import (
    authenticate_user, create_access_token,
    get_current_user, Token
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_payload(user: dict) -> dict:
    """Build the public user object returned by login and /me."""
    return {
        "id":            user["id"],
        "username":      user["username"],
        "role":          user.get("role", "reseller"),
        "name":          user.get("name", ""),
        "reseller_id":   user.get("reseller_id"),
        "is_super_admin": bool(user.get("is_super_admin", False)),
        "permissions":   user.get("permissions") or {},
    }


@router.post("/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(data={"sub": user["username"]})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_payload(user),
    }


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return _user_payload(current_user)
