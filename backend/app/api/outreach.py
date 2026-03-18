from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from app.core.auth import get_current_user, get_supabase

router = APIRouter()


class SendRequest(BaseModel):
    campaign_id: str
    creator_ids: list[str]
    subject: str
    body: str
    dry_run: bool = True


@router.post("/send")
async def send_outreach(
    body: SendRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    supabase=Depends(get_supabase),
):
    """Send outreach emails as a background task."""
    if body.dry_run:
        # Preview mode — return filled templates without sending
        creators = []
        for cid in body.creator_ids:
            result = supabase.table("creators").select("*").eq("id", cid).execute()
            if result.data:
                creator = result.data[0]
                creators.append({
                    "creator_id": cid,
                    "handle": creator["handle"],
                    "email": creator["emails"][0] if creator.get("emails") and len(creator["emails"]) > 0 else None,
                    "subject": body.subject,
                    "body": body.body.replace("{{recipient_name}}", f"@{creator['handle']}"),
                })
        return {"preview": creators}

    # Real send — create task
    task = supabase.table("tasks").insert({
        "campaign_id": body.campaign_id,
        "user_id": user.id,
        "type": "outreach_batch",
        "status": "queued",
        "total": len(body.creator_ids),
    }).execute()

    task_id = task.data[0]["id"]

    # TODO: background_tasks.add_task(run_outreach, task_id, body, supabase)
    return {"task_id": task_id}
