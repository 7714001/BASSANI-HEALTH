from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    mongo_url:  str = "mongodb://localhost:27017"
    db_name:    str = "bassani_internal"
    jwt_secret: str = "change-me-in-production"
    jwt_expire_minutes: int = 480
    odoo_url:      str = ""
    odoo_db:       str = ""
    odoo_username: str = ""
    odoo_password: str = ""
    resend_api_key:   str = ""
    sender_email:     str = "noreply@bassanihealth.com"
    healthcare_email: str = "healthcare@bassanihealth.com"
    packing_emails:   str = "packing@bassanihealth.com,warehouse@bassanihealth.com"
    vapid_public_key:    str = ""
    vapid_private_key:   str = ""
    vapid_claims_email:  str = "admin@bassanihealth.com"
    invoice_start_number: int = 34687
    facility_name:    str = "Bassani Health, 15 Innovation Drive, Midrand"
    facility_address: str = "15 Innovation Drive, Midrand, 1685"
    vat_number:       str = "4830271890"
    bank_name:        str = "FNB"
    bank_account:     str = "62834719283"
    bank_branch:      str = "250655"
    low_stock_default_min: int = 10
    expiry_warning_days:   int = 60
    forecast_lookback_weeks: int = 8
    reorder_alert_days:      int = 30
    require_2fa_admin: bool = False
    cors_origins: str = "*"

    class Config:
        env_file = ".env"
        extra = "ignore"

    def packing_email_list(self):
        return [e.strip() for e in self.packing_emails.split(",") if e.strip()]

    def cors_origins_list(self):
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
