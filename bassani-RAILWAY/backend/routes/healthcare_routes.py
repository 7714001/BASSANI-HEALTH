from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from database import col, NO_ID
from config import get_settings
import uuid

router = APIRouter(prefix="/api/healthcare", tags=["healthcare"])
settings = get_settings()

# ── Pydantic models ───────────────────────────────────────────────────────────

class HealthcareProfessionalSubmit(BaseModel):
    # Professional identity
    hpcsa_number: str
    profession: str                             # GP|Specialist|Pharmacist|Nurse
    full_name: str
    email: str
    phone: str

    # Practice details
    practice_name: str
    practice_location: str
    practice_type: str = "Private"              # Private|Public|Both
    years_in_practice: int

    # Prescribing intent
    currently_prescribing: str = "Planning"     # Yes|No|Planning
    conditions_of_interest: str
    estimated_patients: str

    # Section 21 experience
    section21_familiar: str = "No"              # Yes|No|Somewhat
    section21_experience: Optional[str] = ""

    # Requests
    interested_in_training: bool = False
    request_product_catalog: bool = False
    schedule_consultation: bool = False

    # Comments
    additional_comments: Optional[str] = ""


class StatusUpdate(BaseModel):
    status: str                                 # pending|contacted|approved|declined
    notes: Optional[str] = ""


# ── Email helpers ─────────────────────────────────────────────────────────────

async def send_confirmation_email(submission: dict):
    """Send confirmation email to the healthcare professional via Resend."""
    if not settings.resend_api_key or settings.resend_api_key == "re_your_key_here":
        print(f"📧 [Mock] Confirmation email would be sent to {submission['email']}")
        return

    try:
        import resend
        resend.api_key = settings.resend_api_key

        resend.Emails.send({
            "from": settings.sender_email,
            "to": submission["email"],
            "subject": "Thank you for registering with Bassani Health",
            "html": f"""
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#0f6e56;padding:24px;border-radius:8px 8px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:22px;">Bassani Health</h1>
                <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;">Healthcare Professional Registration</p>
              </div>
              <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;">
                <p>Dear {submission['full_name']},</p>
                <p>Thank you for registering your interest in Bassani Health's medical cannabis products.
                We have received your submission and a member of our healthcare team will be in touch
                within <strong>48 hours</strong>.</p>
                <div style="background:#f9fafb;border-radius:8px;padding:16px;margin:20px 0;">
                  <p style="margin:0 0 8px;font-weight:bold;">Your registration summary:</p>
                  <p style="margin:4px 0;">HPCSA Number: <strong>{submission['hpcsa_number']}</strong></p>
                  <p style="margin:4px 0;">Practice: <strong>{submission['practice_name']}</strong></p>
                  <p style="margin:4px 0;">Location: <strong>{submission['practice_location']}</strong></p>
                </div>
                <p>If you have any urgent queries, please contact us at
                <a href="mailto:{settings.healthcare_email}">{settings.healthcare_email}</a>.</p>
                <p>Kind regards,<br><strong>Bassani Health Medical Team</strong></p>
              </div>
              <div style="padding:12px 24px;background:#f9fafb;border-radius:0 0 8px 8px;font-size:12px;color:#6b7280;">
                This email was sent because you submitted a registration form on bassanihealth.com
              </div>
            </div>
            """,
        })
    except Exception as e:
        print(f"⚠️  Email send failed: {e}")


async def send_team_notification(submission: dict):
    """Notify the Bassani healthcare team of a new submission."""
    if not settings.resend_api_key or settings.resend_api_key == "re_your_key_here":
        print(f"📧 [Mock] Team notification would be sent for {submission['full_name']}")
        return

    try:
        import resend
        resend.api_key = settings.resend_api_key

        requests_list = []
        if submission.get("interested_in_training"):
            requests_list.append("Training session")
        if submission.get("request_product_catalog"):
            requests_list.append("Product catalogue")
        if submission.get("schedule_consultation"):
            requests_list.append("Consultation")
        requests_str = ", ".join(requests_list) or "None specified"

        resend.Emails.send({
            "from": settings.sender_email,
            "to": settings.healthcare_email,
            "subject": f"New Healthcare Registration — {submission['full_name']} ({submission['profession']})",
            "html": f"""
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#0f172a;padding:24px;border-radius:8px 8px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:18px;">New Healthcare Professional Registration</h1>
                <p style="color:#5DCAA5;margin:4px 0 0;">Action required within 48 hours</p>
              </div>
              <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;">
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                  <tr><td style="padding:8px 0;color:#6b7280;width:40%;">Full name</td><td style="padding:8px 0;font-weight:bold;">{submission['full_name']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">HPCSA Number</td><td style="padding:8px 0;">{submission['hpcsa_number']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Profession</td><td style="padding:8px 0;">{submission['profession']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;"><a href="mailto:{submission['email']}">{submission['email']}</a></td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Phone</td><td style="padding:8px 0;">{submission['phone']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Practice</td><td style="padding:8px 0;">{submission['practice_name']}, {submission['practice_location']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Years in practice</td><td style="padding:8px 0;">{submission['years_in_practice']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Currently prescribing</td><td style="padding:8px 0;">{submission['currently_prescribing']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Section 21 familiar</td><td style="padding:8px 0;">{submission['section21_familiar']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Conditions of interest</td><td style="padding:8px 0;">{submission['conditions_of_interest']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Estimated patients</td><td style="padding:8px 0;">{submission['estimated_patients']}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Requests</td><td style="padding:8px 0;">{requests_str}</td></tr>
                  <tr><td style="padding:8px 0;color:#6b7280;">Comments</td><td style="padding:8px 0;">{submission.get('additional_comments') or '—'}</td></tr>
                </table>
              </div>
            </div>
            """,
        })
    except Exception as e:
        print(f"⚠️  Team notification failed: {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/onboarding")
async def submit_onboarding(
    submission: HealthcareProfessionalSubmit,
    background_tasks: BackgroundTasks,
):
    """
    Public endpoint — no auth required.
    Healthcare professionals submit this from the public website.
    Sends two emails (confirmation + team notification) as background tasks.
    """
    # Check for duplicate HPCSA number
    existing = await col("healthcare_professionals").find_one(
        {"hpcsa_number": submission.hpcsa_number}
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="A registration with this HPCSA number already exists. "
                   "Please contact us at healthcare@bassanihealth.com"
        )

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid.uuid4()),
        **submission.model_dump(),
        "status": "pending",
        "admin_notes": "",
        "submitted_at": now,
        "created_at": now,
        "updated_at": now,
    }

    await col("healthcare_professionals").insert_one(doc)

    # Fire emails in background — don't block the response
    background_tasks.add_task(send_confirmation_email, doc)
    background_tasks.add_task(send_team_notification, doc)

    return {
        "success": True,
        "message": "Registration received. We will be in touch within 48 hours.",
        "reference": doc["id"],
    }


@router.get("/submissions")
async def list_submissions(
    status: Optional[str] = None,
    profession: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(require_admin),
):
    """List all healthcare professional submissions. Admin only."""
    query = {}
    if status and status != "all":
        query["status"] = status
    if profession and profession != "all":
        query["profession"] = {"$regex": profession, "$options": "i"}
    if search:
        query["$or"] = [
            {"full_name": {"$regex": search, "$options": "i"}},
            {"hpcsa_number": {"$regex": search, "$options": "i"}},
            {"practice_name": {"$regex": search, "$options": "i"}},
            {"practice_location": {"$regex": search, "$options": "i"}},
        ]

    cursor = (
        col("healthcare_professionals")
        .find(query, NO_ID)
        .sort("submitted_at", -1)
        .skip(offset)
        .limit(limit)
    )
    submissions = await cursor.to_list(length=limit)
    total = await col("healthcare_professionals").count_documents(query)

    # Summary stats
    pending   = await col("healthcare_professionals").count_documents({"status": "pending"})
    contacted = await col("healthcare_professionals").count_documents({"status": "contacted"})
    approved  = await col("healthcare_professionals").count_documents({"status": "approved"})
    declined  = await col("healthcare_professionals").count_documents({"status": "declined"})

    return {
        "submissions": submissions,
        "total": total,
        "stats": {
            "pending": pending,
            "contacted": contacted,
            "approved": approved,
            "declined": declined,
        },
    }


@router.get("/submissions/{submission_id}")
async def get_submission(
    submission_id: str,
    current_user: dict = Depends(require_admin),
):
    """Get a single healthcare professional submission. Admin only."""
    doc = await col("healthcare_professionals").find_one({"id": submission_id}, NO_ID)
    if not doc:
        raise HTTPException(status_code=404, detail="Submission not found")
    return doc


@router.put("/submissions/{submission_id}/status")
async def update_submission_status(
    submission_id: str,
    update: StatusUpdate,
    current_user: dict = Depends(require_admin),
):
    """Update the status of a healthcare professional submission. Admin only."""
    valid_statuses = {"pending", "contacted", "approved", "declined"}
    if update.status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
        )

    result = await col("healthcare_professionals").update_one(
        {"id": submission_id},
        {
            "$set": {
                "status": update.status,
                "admin_notes": update.notes or "",
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")

    return {"success": True, "status": update.status}


@router.delete("/submissions/{submission_id}")
async def delete_submission(
    submission_id: str,
    current_user: dict = Depends(require_admin),
):
    """Hard delete a submission (POPIA compliance — on request). Admin only."""
    result = await col("healthcare_professionals").delete_one({"id": submission_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Submission not found")
    return {"success": True, "message": "Submission permanently deleted"}
