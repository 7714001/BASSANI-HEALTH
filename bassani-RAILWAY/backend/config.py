from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    mongo_url: str = "mongodb://localhost:27017"
    db_name: str = "bassani_internal"
    jwt_secret: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24
    cors_origins: str = "*"
    odoo_url: str = "http://localhost:8069"
    odoo_db: str = "odoo"
    odoo_username: str = "admin"
    odoo_password: str = "admin"
    resend_api_key: str = ""
    sender_email: str = "noreply@bassanihealth.com"
    healthcare_email: str = "healthcare@bassanihealth.com"
    picking_emails: str = "packing@bassanihealth.com,warehouse@bassanihealth.com"
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_claims_email: str = "admin@bassanihealth.com"
    totp_issuer: str = "Bassani Health"
    doc_number_start: int = 34687
    facility_name: str = "Bassani Health, 15 Innovation Drive, Midrand"
    facility_phone: str = "+27 11 000 0000"
    facility_email: str = "info@bassanihealth.com"
    script_expiry_warn_days: int = 30
    aged_debtors_critical_days: int = 60
    forecast_weeks: int = 12

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
