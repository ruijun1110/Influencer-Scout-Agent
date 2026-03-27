import asyncio
import logging
import re as _re
from datetime import date
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import get_current_user, get_supabase
from app.core.campaign_access import ensure_user_owns_campaign
from app.core.config import get_settings
from app.services import tikhub, enrich
from app.services.tikhub import TikHubAPIError


def _sanitize_error(e: Exception) -> str:
    """Remove sensitive data from error messages before storing in DB."""
    msg = str(e)[:300]
    msg = _re.sub(r'Bearer\s+\S+', 'Bearer ***', msg)
    msg = _re.sub(r'eyJ[A-Za-z0-9_-]+', '***', msg)
    return msg


class ScoutRunRequest(BaseModel):
    campaign_id: str
    source_type: str
    source_params: dict
    preset_id: Optional[str] = None
    name: str | None = None
    filters: dict | None = None

logger = logging.getLogger(__name__)

router = APIRouter()


def _tasks_update(supabase, task_id: str, fields: dict, *, context: str) -> None:
    """Update a tasks row; log if no rows match (RLS, wrong id, or stale client)."""
    try:
        r = supabase.table("tasks").update(fields).eq("id", task_id).execute()
    except Exception as e:
        logger.error("tasks.update failed context=%s task_id=%s: %s", context, task_id, e)
        raise
    data = getattr(r, "data", None)
    if not data:
        logger.warning(
            "tasks.update returned no rows (check RLS / task id) context=%s task_id=%s keys=%s",
            context,
            task_id,
            list(fields.keys()),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _handle_from_tt_link(tt_link: str) -> str:
    """Extract handle from TikTok profile URL like https://www.tiktok.com/@handle"""
    if not tt_link:
        return ""
    parts = tt_link.rstrip("/").split("@")
    return parts[-1] if len(parts) > 1 else ""


def _check_qualified(profile: dict, extra_fields: dict, preset_snapshot: dict | None) -> bool:
    """Check if a creator meets the preset filter thresholds.

    Checks: followers, avg_views, engagement_rate, total_likes, video_count.
    Does NOT check has_email (post-discovery only) or min_video_views (pre-fetch).
    """
    if not preset_snapshot:
        return True

    checks = {
        "followers": profile.get("followers", 0),
        "avg_views": profile.get("avg_views", 0),
        "total_likes": profile.get("total_likes", 0),
        "video_count": profile.get("video_count", 0),
    }
    checks["engagement_rate"] = extra_fields.get("engagement_rate") or profile.get("engagement_rate", 0)

    for key, value in checks.items():
        filt = preset_snapshot.get(key)
        if not filt or not isinstance(filt, dict):
            continue
        if filt.get("min") is not None and value < filt["min"]:
            return False
        if filt.get("max") is not None and value > filt["max"]:
            return False

    return True


async def _enrich_and_upsert_creator(
    handle: str,
    profile: dict,
    extra_fields: dict,
    campaign_id: str,
    batch_id: str,
    cc_fields: dict,
    supabase,
    preview_image_url: str | None = None,
    trigger_video_url: str | None = None,
    trigger_video_views: int = 0,
    qualified: bool = True,
) -> str | None:
    """Enrich a creator with emails, upsert to creators table, link to campaign.

    ``preview_image_url`` is stored on ``campaign_creators`` (video / marketplace thumb);
    omit for similar-source rows (UI uses profile ``cover_url``).
    ``trigger_video_url`` is the TikTok video URL for click-to-play on discover cards.

    Returns the creator_id on success, None on failure.
    """
    # Enrich with emails
    bio_emails = enrich.extract_emails_from_bio(profile.get("bio", ""))
    link_emails = await enrich.extract_emails_from_url(profile.get("bio_link", ""))
    all_emails = enrich.filter_emails(list(dict.fromkeys(bio_emails + link_emails)))

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
        campaign_creator_data["preview_image_url"] = preview_image_url
        campaign_creator_data["trigger_video_url"] = trigger_video_url
        campaign_creator_data["trigger_video_views"] = trigger_video_views
        campaign_creator_data["qualified"] = qualified

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
    tikhub_key: str = "",
):
    """Run a scout batch for any source_type: keyword_creator, keyword_video, similar."""
    try:
        # Mark task as running
        _tasks_update(supabase, task_id, {"status": "running"}, context="run_scout_batch:running")

        if source_type == "keyword_creator":
            # Creator Marketplace source temporarily disabled
            _tasks_update(supabase, task_id, {
                "status": "failed",
                "error": "Creator Marketplace source is temporarily unavailable. Use Keyword Search instead.",
            }, context="keyword_creator:disabled")
            return
        elif source_type == "keyword_video":
            created_count, skipped_count, qualified_count = await _run_keyword_video(
                task_id, batch_id, campaign_id, source_params, supabase, tikhub_key=tikhub_key
            )
        elif source_type == "similar":
            created_count, skipped_count, qualified_count = await _run_similar(
                task_id, batch_id, campaign_id, source_params, supabase, tikhub_key=tikhub_key
            )
        else:
            raise ValueError(f"Unknown source_type: {source_type}")

        # Update scout_batches.creator_count
        supabase.table("scout_batches").update({
            "creator_count": created_count,
        }).eq("id", batch_id).execute()

        # Mark task completed or partial (when some creators were skipped)
        final_status = "partial" if skipped_count > 0 and created_count > 0 else "completed"
        _tasks_update(
            supabase,
            task_id,
            {
                "status": final_status,
                "meta": {
                    "source_type": source_type,
                    "source_params": source_params,
                    "result_count": qualified_count,
                    "total_stored": created_count,
                    **({"skipped_count": skipped_count} if skipped_count > 0 else {}),
                },
            },
            context="run_scout_batch:completed",
        )

    except Exception as e:
        logger.exception("run_scout_batch failed for task %s", task_id)
        _tasks_update(
            supabase,
            task_id,
            {"status": "failed", "error": _sanitize_error(e)},
            context="run_scout_batch:failed",
        )


# ---------------------------------------------------------------------------
# Source type handlers
# ---------------------------------------------------------------------------

async def _run_keyword_creator(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
    tikhub_key: str = "",
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
        try:
            creators = await tikhub.search_creators_paginated(
                keyword, country=country, sort_by=sort_by, max_results=max_results, api_key=tikhub_key
            )
        except Exception as e:
            logger.warning("keyword_creator: search_creators failed for %r, skipping: %s", keyword, e)
            continue
        for creator in creators:
            all_creators.append((creator, keyword))

    total = len(all_creators)
    processed = 0

    supabase.table("tasks").update({
        "total": total,
    }).eq("id", task_id).execute()

    sem = asyncio.Semaphore(3)
    results_lock = asyncio.Lock()

    async def process_one(creator, keyword):
        nonlocal processed, created_count

        search_result = tikhub.parse_creator_search_result(creator)

        # Parse handle from tt_link
        handle = _handle_from_tt_link(search_result.get("profile_url", ""))

        async with results_lock:
            if not handle or handle in seen_handles:
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_creator:progress")
                return
            seen_handles.add(handle)

        try:
            async with sem:
                # Get full profile for bio, bio_link, sec_uid, etc.
                user_info = await tikhub.get_user_profile(handle, api_key=tikhub_key)
                profile = tikhub.parse_profile_fields(user_info)

                # Merge search result metrics into profile (search has avg_views, median_views, etc.)
                profile["avg_views"] = search_result.get("avg_views", 0) or profile["avg_views"]

                extra_fields = {
                    "median_views": search_result.get("median_views", 0),
                    "engagement_rate": search_result.get("engagement_rate", 0),
                    "tcm_id": search_result.get("tcm_id", ""),
                    "tcm_link": search_result.get("tcm_link", ""),
                }

                preview_url = tikhub.extract_marketplace_creator_cover_url(creator)
                trigger_url = tikhub.extract_trigger_video_url(creator, handle)

                cid = await _enrich_and_upsert_creator(
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
                    preview_image_url=preview_url,
                    trigger_video_url=trigger_url,
                )

            async with results_lock:
                if cid:
                    created_count += 1
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_creator:progress")

        except Exception as e:
            logger.warning("Failed to process @%s: %s", handle, e)
            async with results_lock:
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_creator:progress")

    await asyncio.gather(*[process_one(c, kw) for c, kw in all_creators], return_exceptions=True)

    # Final progress sync (in case total wasn't a multiple of 5)
    _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_creator:final")

    return created_count


async def _run_keyword_video(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
    tikhub_key: str = "",
) -> tuple[int, int, int]:
    """Search TikTok videos by keywords with pagination, enrich creators, and store.

    Returns (created_count, skipped_count, qualified_count).
    """
    keywords = source_params.get("keywords", [])
    region = source_params.get("country", "US")

    PAGE_SIZE = 20
    MAX_PAGES = 3

    created_count = 0
    skipped_count = 0
    qualified_count = 0
    seen_handles: set[str] = set()
    processed = 0

    # Estimated total for progress bar (3 pages × 20 items × keywords)
    estimated_total = PAGE_SIZE * MAX_PAGES * len(keywords)
    supabase.table("tasks").update({"total": estimated_total}).eq("id", task_id).execute()

    # Fetch preset_snapshot from scout_batches for threshold + qualification checks
    preset_snapshot = None
    try:
        batch_row = supabase.table("scout_batches").select("preset_snapshot").eq("id", batch_id).execute()
        if batch_row.data:
            preset_snapshot = batch_row.data[0].get("preset_snapshot")
    except Exception:
        logger.debug("keyword_video: could not fetch preset_snapshot for batch %s", batch_id)

    sem = asyncio.Semaphore(3)
    results_lock = asyncio.Lock()

    for kw_idx, keyword in enumerate(keywords):
        if kw_idx > 0:
            await asyncio.sleep(1.0)

        for page in range(MAX_PAGES):
            offset = page * PAGE_SIZE
            if page > 0:
                await asyncio.sleep(1.0)

            try:
                raw = await tikhub.search_videos(
                    keyword, count=PAGE_SIZE, offset=offset,
                    region=region, api_key=tikhub_key,
                )
            except TikHubAPIError:
                raise  # Auth/payment errors must surface to the user
            except Exception as e:
                logger.warning("keyword_video: search_videos failed for %r page %d: %s", keyword, page, e)
                break

            items = tikhub._extract_search_items(raw)
            if not items:
                break  # No more results

            # Track counts for this page
            page_qualified = 0
            page_created = 0
            page_skipped = 0

            async def process_one(item, kw):
                nonlocal processed, page_qualified, page_created, page_skipped

                author_info = tikhub._extract_video_author(item)
                handle = author_info["handle"]

                # Extract trigger video view count
                item_stats = item.get("statistics") or item.get("stats") or {}
                trigger_views = item_stats.get("playCount") or item_stats.get("play_count") or item.get("vv") or 0
                try:
                    trigger_views = int(trigger_views)
                except (TypeError, ValueError):
                    trigger_views = 0

                # Pre-fetch filter: min_video_views
                min_video_views = (preset_snapshot or {}).get("min_video_views")
                if min_video_views and trigger_views < int(min_video_views):
                    async with results_lock:
                        processed += 1
                        if processed % 5 == 0:
                            _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_video:progress")
                    return

                async with results_lock:
                    if not handle or handle in seen_handles:
                        processed += 1
                        if processed % 5 == 0:
                            _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_video:progress")
                        return
                    seen_handles.add(handle)

                try:
                    async with sem:
                        preview_url = tikhub.extract_video_item_cover_url(item)
                        trigger_url = tikhub.extract_trigger_video_url(item, handle)
                        user_info = await tikhub.get_user_profile(handle, api_key=tikhub_key)
                        profile = await tikhub.parse_profile_fields_with_avg_views(user_info, api_key=tikhub_key)

                        extra_fields = {
                            "engagement_rate": profile.get("engagement_rate", 0),
                            "raw_videos": profile.get("top_videos", []),
                        }

                        # Post-fetch qualification check
                        is_qualified = _check_qualified(profile, extra_fields, preset_snapshot)

                        cid = await _enrich_and_upsert_creator(
                            handle=handle,
                            profile=profile,
                            extra_fields=extra_fields,
                            campaign_id=campaign_id,
                            batch_id=batch_id,
                            cc_fields={
                                "source_type": "search",
                                "source_keyword": kw,
                            },
                            supabase=supabase,
                            preview_image_url=preview_url,
                            trigger_video_url=trigger_url,
                            trigger_video_views=trigger_views,
                            qualified=is_qualified,
                        )

                    async with results_lock:
                        if cid:
                            page_created += 1
                            if is_qualified:
                                page_qualified += 1
                        processed += 1
                        if processed % 5 == 0:
                            _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_video:progress")

                except TikHubAPIError:
                    raise  # Auth/payment errors must surface
                except Exception as e:
                    logger.warning("Failed to process @%s: %s", handle, e)
                    async with results_lock:
                        page_skipped += 1
                        processed += 1
                        if processed % 5 == 0:
                            _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_video:progress")

            # Run concurrently but let TikHubAPIError propagate
            results = await asyncio.gather(*[process_one(it, keyword) for it in items], return_exceptions=True)
            for r in results:
                if isinstance(r, TikHubAPIError):
                    raise r

            created_count += page_created
            skipped_count += page_skipped
            qualified_count += page_qualified

            _tasks_update(supabase, task_id, {"progress": processed}, context="keyword_video:page_done")

            # Stop paginating if this page had very few new results (diminishing returns)
            if page_created == 0:
                break

    # Final progress sync — set total to actual processed
    _tasks_update(supabase, task_id, {"progress": processed, "total": processed}, context="keyword_video:final")

    return created_count, skipped_count, qualified_count


async def _run_similar(
    task_id: str,
    batch_id: str,
    campaign_id: str,
    source_params: dict,
    supabase,
    tikhub_key: str = "",
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
        user_info = await tikhub.get_user_profile(source_handle, api_key=tikhub_key)
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
    similar_users = await tikhub.get_similar_users(sec_uid, api_key=tikhub_key)

    total = len(similar_users)
    processed = 0
    created_count = 0
    skipped_count = 0

    supabase.table("tasks").update({
        "total": total,
    }).eq("id", task_id).execute()

    if not similar_users:
        return 0

    sem = asyncio.Semaphore(3)
    results_lock = asyncio.Lock()

    async def process_one(user):
        nonlocal processed, created_count

        handle = tikhub.parse_similar_user(user)

        async with results_lock:
            if not handle:
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="similar:progress")
                return

        try:
            async with sem:
                # Get full profile with avg_views and engagement_rate
                user_info = await tikhub.get_user_profile(handle, api_key=tikhub_key)
                profile = await tikhub.parse_profile_fields_with_avg_views(user_info, api_key=tikhub_key)

                extra_fields = {
                    "engagement_rate": profile.get("engagement_rate", 0),
                    "raw_videos": profile.get("top_videos", []),
                }

                # Use top video cover for card preview (consistent with keyword-sourced cards)
                top_vids = profile.get("top_videos", [])
                preview_url = top_vids[0]["cover_url"] if top_vids and top_vids[0].get("cover_url") else None
                trigger_url = None
                if top_vids and top_vids[0].get("video_id"):
                    trigger_url = f"https://www.tiktok.com/@{handle}/video/{top_vids[0]['video_id']}"

                cid = await _enrich_and_upsert_creator(
                    handle=handle,
                    profile=profile,
                    extra_fields=extra_fields,
                    campaign_id=campaign_id,
                    batch_id=batch_id,
                    cc_fields={
                        "source_type": "similar",
                        **({"source_creator_id": creator_id} if creator_id else {}),
                        "source_handle": source_handle,
                    },
                    supabase=supabase,
                    preview_image_url=preview_url,
                    trigger_video_url=trigger_url,
                )

            async with results_lock:
                if cid:
                    created_count += 1
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="similar:progress")

        except TikHubAPIError:
            raise
        except Exception as e:
            logger.warning("Failed to process similar user @%s: %s", handle, e)
            async with results_lock:
                skipped_count += 1
                processed += 1
                if processed % 5 == 0 or processed == total:
                    _tasks_update(supabase, task_id, {"progress": processed}, context="similar:progress")

    results = await asyncio.gather(*[process_one(u) for u in similar_users], return_exceptions=True)
    for r in results:
        if isinstance(r, TikHubAPIError):
            raise r

    # Final progress sync
    _tasks_update(supabase, task_id, {"progress": processed}, context="similar:final")

    return created_count, skipped_count, created_count  # all similar creators are qualified


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
    ensure_user_owns_campaign(supabase, user.id, body.campaign_id)

    # Get user's TikHub API key (DB first, then env fallback)
    key_result = supabase.table("user_api_keys").select("tikhub_api_key").eq("user_id", user.id).execute()
    tikhub_key = key_result.data[0]["tikhub_api_key"] if key_result.data else None
    if not tikhub_key:
        tikhub_key = get_settings().tikhub_api_key
    if not tikhub_key:
        raise HTTPException(400, "TikHub API key not configured. Add it in Settings \u2192 API Keys.")

    source_params = dict(body.source_params)
    if body.source_type == "similar":
        cid = source_params.get("creator_id")
        if cid and not source_params.get("creator_handle"):
            try:
                cr = (
                    supabase.table("creators")
                    .select("handle")
                    .eq("id", cid)
                    .single()
                    .execute()
                )
                h = (cr.data or {}).get("handle")
                if h:
                    source_params["creator_handle"] = h
            except Exception:
                logger.debug(
                    "Could not resolve creator_handle for similar scout (creator_id=%s)",
                    cid,
                    exc_info=True,
                )

    # Determine preset_snapshot: inline filters take priority over preset_id
    preset_snapshot = None
    if body.filters:
        preset_snapshot = body.filters
    elif body.preset_id:
        try:
            preset_result = supabase.table("scout_presets").select("filters").eq(
                "id", body.preset_id
            ).single().execute()
            preset_snapshot = preset_result.data.get("filters") if preset_result.data else None
        except Exception:
            logger.warning("Failed to fetch preset %s, continuing without snapshot", body.preset_id)

    # Auto-generate batch name if not provided
    batch_name = body.name
    if not batch_name:
        today = date.today().strftime("%Y-%m-%d")
        if body.source_type == "similar":
            handle = source_params.get("creator_handle", "")
            batch_name = f"{today} · Similar @{handle}"
        else:
            kws = source_params.get("keywords", [])
            kw_str = ", ".join(kws[:3])
            if len(kws) > 3:
                kw_str += f" +{len(kws) - 3}"
            batch_name = f"{today} · {kw_str}"

    # Create scout_batches row
    batch_result = supabase.table("scout_batches").insert({
        "campaign_id": body.campaign_id,
        "source_type": body.source_type,
        "source_params": source_params,
        "preset_id": body.preset_id,
        "preset_snapshot": preset_snapshot,
        "name": batch_name,
        "creator_count": 0,
    }).execute()

    if not batch_result.data:
        raise HTTPException(status_code=500, detail="Failed to create scout batch")
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
            "source_params": source_params,
        },
    }).execute()

    if not task_result.data:
        raise HTTPException(status_code=500, detail="Failed to create task")
    task_id = task_result.data[0]["id"]

    # Link task to batch
    supabase.table("scout_batches").update({"task_id": task_id}).eq("id", batch_id).execute()

    # Launch background task
    background_tasks.add_task(
        run_scout_batch, task_id, batch_id, body.campaign_id,
        body.source_type, source_params, supabase, tikhub_key=tikhub_key,
    )

    return {"task_id": task_id, "batch_id": batch_id}
