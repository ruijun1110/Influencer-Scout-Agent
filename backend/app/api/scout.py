import logging
from typing import Optional

from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel

from app.core.auth import get_current_user, get_supabase
from app.services import tikhub, enrich


class ScoutRunRequest(BaseModel):
    campaign_id: str
    source_type: str
    source_params: dict
    preset_id: Optional[str] = None

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _handle_from_tt_link(tt_link: str) -> str:
    """Extract handle from TikTok profile URL like https://www.tiktok.com/@handle"""
    if not tt_link:
        return ""
    parts = tt_link.rstrip("/").split("@")
    return parts[-1] if len(parts) > 1 else ""


async def _enrich_and_upsert_creator(
    handle: str,
    profile: dict,
    extra_fields: dict,
    campaign_id: str,
    batch_id: str,
    cc_fields: dict,
    supabase,
) -> str | None:
    """Enrich a creator with emails, upsert to creators table, link to campaign.

    Returns the creator_id on success, None on failure.
    """
    # Enrich with emails
    bio_emails = enrich.extract_emails_from_bio(profile.get("bio", ""))
    link_emails = await enrich.extract_emails_from_url(profile.get("bio_link", ""))
    all_emails = list(set(bio_emails + link_emails))

    # Build creator data from profile + extra fields
    creator_data = {
        "handle": handle,
        "profile_url": f"https://www.tiktok.com/@{handle}",
        "bio": profile.get("bio", ""),
        "bio_link": profile.get("bio_link", ""),
        "cover_url": profile.get("cover_url", ""),
        "followers": profile.get("followers", 0),
        "avg_views": profile.get("avg_views", 0),
        "emails": all_emails,
        "sec_uid": profile.get("sec_uid", ""),
        "total_likes": profile.get("total_likes", 0),
        "video_count": profile.get("video_count", 0),
        "following_count": profile.get("following_count", 0),
        "verified": profile.get("verified", False),
        "country_code": profile.get("country_code", ""),
        "nickname": profile.get("nickname", ""),
    }
    # Merge extra fields (e.g. median_views, engagement_rate from search)
    creator_data.update(extra_fields)

    try:
        result = supabase.table("creators").upsert(
            creator_data, on_conflict="handle"
        ).execute()

        if not result.data:
            logger.warning("Creator upsert returned no data for @%s", handle)
            return None

        creator_id = result.data[0]["id"]

        # Link creator to campaign
        campaign_creator_data = {
            "campaign_id": campaign_id,
            "creator_id": creator_id,
            "batch_id": batch_id,
            "status": "unreviewed",
        }
        campaign_creator_data.update(cc_fields)

        supabase.table("campaign_creators").upsert(
            campaign_creator_data,
            on_conflict="campaign_id,creator_id",
        ).execute()

        return creator_id
    except Exception as e:
        logger.warning("Failed to upsert creator @%s: %s", handle, e)
        return None


# ---------------------------------------------------------------------------
# Background task: unified scout batch
# ---------------------------------------------------------------------------

async def run_scout_batch(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_type: str,
    source_params: dict,
    supabase,
):
    """Run a scout batch for any source_type: keyword_creator, keyword_video, similar."""
    try:
        # Mark task as running
        supabase.table("tasks").update({
            "status": "running",
        }).eq("id", task_id).execute()

        if source_type == "keyword_creator":
            created_count = await _run_keyword_creator(
                task_id, batch_id, campaign_id, source_params, supabase
            )
        elif source_type == "keyword_video":
            created_count = await _run_keyword_video(
                task_id, batch_id, campaign_id, source_params, supabase
            )
        elif source_type == "similar":
            created_count = await _run_similar(
                task_id, batch_id, campaign_id, source_params, supabase
            )
        else:
            raise ValueError(f"Unknown source_type: {source_type}")

        # Update scout_batches.creator_count
        supabase.table("scout_batches").update({
            "creator_count": created_count,
        }).eq("id", batch_id).execute()

        # Mark task completed
        supabase.table("tasks").update({
            "status": "completed",
            "meta": {
                "source_type": source_type,
                "source_params": source_params,
                "result_count": created_count,
            },
        }).eq("id", task_id).execute()

    except Exception as e:
        logger.exception("run_scout_batch failed for task %s", task_id)
        supabase.table("tasks").update({
            "status": "failed",
            "error": str(e),
        }).eq("id", task_id).execute()


# ---------------------------------------------------------------------------
# Source type handlers
# ---------------------------------------------------------------------------

async def _run_keyword_creator(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
) -> int:
    """Search TikTok Creator Marketplace by keywords, enrich, and store."""
    keywords = source_params.get("keywords", [])
    country = source_params.get("country", "US")
    sort_by = source_params.get("sort_by", "avg_views")
    max_results = source_params.get("max_results", 20)

    created_count = 0
    seen_handles: set[str] = set()

    # Calculate total across all keywords for progress tracking
    all_creators: list[tuple[dict, str]] = []  # (creator_dict, keyword)
    for keyword in keywords:
        creators = await tikhub.search_creators_paginated(
            keyword, country=country, sort_by=sort_by, max_results=max_results
        )
        for creator in creators:
            all_creators.append((creator, keyword))

    total = len(all_creators)
    processed = 0

    supabase.table("tasks").update({
        "total": total,
    }).eq("id", task_id).execute()

    for creator, keyword in all_creators:
        search_result = tikhub.parse_creator_search_result(creator)

        # Parse handle from tt_link
        handle = _handle_from_tt_link(search_result.get("profile_url", ""))
        if not handle or handle in seen_handles:
            processed += 1
            supabase.table("tasks").update({
                "progress": processed,
            }).eq("id", task_id).execute()
            continue
        seen_handles.add(handle)

        try:
            # Get full profile for bio, bio_link, sec_uid, etc.
            user_info = await tikhub.get_user_profile(handle)
            profile = tikhub.parse_profile_fields(user_info)

            # Merge search result metrics into profile (search has avg_views, median_views, etc.)
            profile["avg_views"] = search_result.get("avg_views", 0) or profile["avg_views"]

            extra_fields = {
                "median_views": search_result.get("median_views", 0),
                "engagement_rate": search_result.get("engagement_rate", 0),
                "tcm_id": search_result.get("tcm_id", ""),
                "tcm_link": search_result.get("tcm_link", ""),
            }

            creator_id = await _enrich_and_upsert_creator(
                handle=handle,
                profile=profile,
                extra_fields=extra_fields,
                campaign_id=campaign_id,
                batch_id=batch_id,
                cc_fields={
                    "source_type": "search",
                    "source_keyword": keyword,
                },
                supabase=supabase,
            )
            if creator_id:
                created_count += 1

        except Exception as e:
            logger.warning("Failed to process @%s: %s", handle, e)

        processed += 1
        supabase.table("tasks").update({
            "progress": processed,
        }).eq("id", task_id).execute()

    return created_count


async def _run_keyword_video(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
) -> int:
    """Search TikTok videos by keywords, enrich creators, and store."""
    keywords = source_params.get("keywords", [])
    max_results = source_params.get("max_results", 20)

    created_count = 0
    seen_handles: set[str] = set()

    # Collect all video items across keywords
    all_items: list[tuple[dict, str]] = []  # (item, keyword)
    for keyword in keywords:
        raw = await tikhub.search_videos(keyword, count=max_results)
        items = tikhub._extract_search_items(raw)
        for item in items:
            all_items.append((item, keyword))

    total = len(all_items)
    processed = 0

    supabase.table("tasks").update({
        "total": total,
    }).eq("id", task_id).execute()

    for item, keyword in all_items:
        author_info = tikhub._extract_video_author(item)
        handle = author_info["handle"]

        if not handle or handle in seen_handles:
            processed += 1
            supabase.table("tasks").update({
                "progress": processed,
            }).eq("id", task_id).execute()
            continue
        seen_handles.add(handle)

        try:
            # Get full profile with avg_views computed from recent videos
            user_info = await tikhub.get_user_profile(handle)
            profile = await tikhub.parse_profile_fields_with_avg_views(user_info)

            cid = await _enrich_and_upsert_creator(
                handle=handle,
                profile=profile,
                extra_fields={},
                campaign_id=campaign_id,
                batch_id=batch_id,
                cc_fields={
                    "source_type": "search",
                    "source_keyword": keyword,
                },
                supabase=supabase,
            )
            if cid:
                created_count += 1

        except Exception as e:
            logger.warning("Failed to process @%s: %s", handle, e)

        processed += 1
        supabase.table("tasks").update({
            "progress": processed,
        }).eq("id", task_id).execute()

    return created_count


async def _run_similar(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
) -> int:
    """Find similar creators for a given creator, enrich, and store."""
    creator_id = source_params.get("creator_id")
    handle_input = source_params.get("creator_handle", "")

    if creator_id:
        # Existing path: look up from DB
        creator_result = supabase.table("creators").select("handle, sec_uid").eq(
            "id", creator_id
        ).single().execute()
        source_handle = creator_result.data["handle"]
        sec_uid = creator_result.data.get("sec_uid") or ""
    else:
        # New path: parse handle from URL/handle input
        source_handle = tikhub.parse_tiktok_handle(handle_input)
        if not source_handle:
            raise ValueError(f"Could not parse handle from: {handle_input}")
        sec_uid = ""

    # If no sec_uid, fetch profile to get it
    if not sec_uid:
        user_info = await tikhub.get_user_profile(source_handle)
        profile = tikhub.parse_profile_fields(user_info)
        sec_uid = profile["sec_uid"]
        if not sec_uid:
            raise ValueError(f"Could not get sec_uid for @{source_handle}")
        # Store it for future use if we have a creator_id
        if creator_id:
            supabase.table("creators").update({
                "sec_uid": sec_uid,
            }).eq("id", creator_id).execute()

    # Fetch similar users
    similar_users = await tikhub.get_similar_users(sec_uid)

    total = len(similar_users)
    processed = 0
    created_count = 0

    supabase.table("tasks").update({
        "total": total,
    }).eq("id", task_id).execute()

    if not similar_users:
        return 0

    for user in similar_users:
        handle = tikhub.parse_similar_user(user)
        if not handle:
            processed += 1
            supabase.table("tasks").update({
                "progress": processed,
            }).eq("id", task_id).execute()
            continue

        try:
            # Get full profile
            user_info = await tikhub.get_user_profile(handle)
            profile = tikhub.parse_profile_fields(user_info)

            cid = await _enrich_and_upsert_creator(
                handle=handle,
                profile=profile,
                extra_fields={},
                campaign_id=campaign_id,
                batch_id=batch_id,
                cc_fields={
                    "source_type": "similar",
                    **({"source_creator_id": creator_id} if creator_id else {}),
                    "source_handle": source_handle,
                },
                supabase=supabase,
            )
            if cid:
                created_count += 1

        except Exception as e:
            logger.warning("Failed to process similar user @%s: %s", handle, e)

        processed += 1
        supabase.table("tasks").update({
            "progress": processed,
        }).eq("id", task_id).execute()

    return created_count


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------

@router.post("/run")
async def scout_run(
    body: ScoutRunRequest,
    background_tasks: BackgroundTasks,
    user=Depends(get_current_user),
    supabase=Depends(get_supabase),
):
    """Trigger a unified scout batch as a background task."""
    # If preset_id provided, fetch and snapshot preset filters
    preset_snapshot = None
    if body.preset_id:
        try:
            preset_result = supabase.table("scout_presets").select("filters").eq(
                "id", body.preset_id
            ).single().execute()
            preset_snapshot = preset_result.data.get("filters") if preset_result.data else None
        except Exception:
            logger.warning("Failed to fetch preset %s, continuing without snapshot", body.preset_id)

    # Create scout_batches row
    batch_result = supabase.table("scout_batches").insert({
        "campaign_id": body.campaign_id,
        "source_type": body.source_type,
        "source_params": body.source_params,
        "preset_id": body.preset_id,
        "preset_snapshot": preset_snapshot,
        "creator_count": 0,
    }).execute()

    if not batch_result.data:
        raise ValueError("Failed to create scout batch")
    batch_id = batch_result.data[0]["id"]

    # Create tasks row
    task_result = supabase.table("tasks").insert({
        "campaign_id": body.campaign_id,
        "user_id": user.id,
        "type": "scout",
        "status": "queued",
        "progress": 0,
        "total": 0,
        "meta": {
            "source_type": body.source_type,
            "source_params": body.source_params,
        },
    }).execute()

    if not task_result.data:
        raise ValueError("Failed to create task")
    task_id = task_result.data[0]["id"]

    # Link task to batch
    supabase.table("scout_batches").update({"task_id": task_id}).eq("id", batch_id).execute()

    # Launch background task
    background_tasks.add_task(
        run_scout_batch, task_id, batch_id, body.campaign_id,
        body.source_type, body.source_params, supabase,
    )

    return {"task_id": task_id, "batch_id": batch_id}
