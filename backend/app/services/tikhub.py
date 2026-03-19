import re

import httpx
from app.core.config import get_settings

TIKHUB_BASE = "https://api.tikhub.io/api/v1"


def _headers() -> dict:
    settings = get_settings()
    return {"Authorization": f"Bearer {settings.tikhub_api_key}"}


def _extract_search_items(data: dict) -> list[dict]:
    """Try common response shapes to extract video item list from search."""
    inner = data.get("data", {})
    items = inner.get("data")
    if isinstance(items, list):
        return items
    items = inner.get("itemList") or inner.get("item_list")
    if isinstance(items, list):
        return items
    return []


def _extract_video_author(item: dict) -> dict:
    """Extract author info from a search result item.

    The item may have an 'item' wrapper around the actual video data,
    or the video data may be at the top level.
    """
    video = item.get("item") or item
    author = video.get("author") or {}
    stats = video.get("stats") or {}
    return {
        "handle": author.get("uniqueId") or author.get("unique_id") or "",
        "sec_uid": author.get("secUid") or author.get("sec_uid") or "",
        "play_count": stats.get("playCount") or stats.get("play_count") or 0,
        "video_id": video.get("id") or "",
    }


async def search_videos(keyword: str, count: int = 20, offset: int = 0) -> dict:
    """Search TikTok videos by keyword via TikHub API.

    Returns the raw response dict so callers can check has_more and parse items.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TIKHUB_BASE}/tiktok/web/fetch_search_video",
            params={"keyword": keyword, "count": count, "offset": offset, "sort_type": 0},
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()


async def search_videos_parsed(keyword: str, count: int = 20) -> list[dict]:
    """Search and return parsed author/video info dicts."""
    raw = await search_videos(keyword, count=count)
    items = _extract_search_items(raw)
    results = []
    seen = set()
    for item in items:
        info = _extract_video_author(item)
        handle = info["handle"]
        if handle and handle not in seen:
            seen.add(handle)
            results.append(info)
    return results


async def search_creators(
    keyword: str,
    country: str = "US",
    sort_by: str = "avg_views",
    limit: int = 20,
    page: int = 1,
) -> list[dict]:
    """Search TikTok Creator Marketplace for creators by keyword.

    Returns list of creator dicts with fields: tcm_id, user_id, nick_name,
    avatar_url, country_code, follower_cnt, liked_cnt, tt_link, tcm_link,
    items[] (recent videos with vv, liked_cnt, cover_url, create_time).
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TIKHUB_BASE}/tiktok/ads/search_creators",
            params={
                "keyword": keyword,
                "page": page,
                "limit": limit,
                "sort_by": sort_by,
                "creator_country": country,
            },
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        inner = data.get("data", {})
        if isinstance(inner, dict):
            inner = inner.get("data", inner)
        if isinstance(inner, dict):
            return inner.get("creators", [])
        return []


def parse_creator_search_result(creator: dict) -> dict:
    """Extract all fields from a search_creators response item.

    Computes avg_views, median_views, and engagement_rate from included video items.
    """
    items = creator.get("items", [])
    views = [item.get("vv", 0) for item in items if item.get("vv", 0) > 0]
    likes = [item.get("liked_cnt", 0) for item in items]

    avg_v = round(sum(views) / len(views)) if views else 0
    sorted_views = sorted(views)
    median_v = sorted_views[len(sorted_views) // 2] if sorted_views else 0
    total_views = sum(views)
    total_likes_vid = sum(likes)
    eng_rate = round(total_likes_vid / total_views, 4) if total_views > 0 else 0

    return {
        "nickname": creator.get("nick_name", ""),
        "cover_url": creator.get("avatar_url", ""),
        "country_code": creator.get("country_code", ""),
        "followers": creator.get("follower_cnt", 0),
        "total_likes": creator.get("liked_cnt", 0),
        "profile_url": creator.get("tt_link", ""),
        "tcm_id": creator.get("tcm_id", ""),
        "tcm_link": creator.get("tcm_link", ""),
        "avg_views": avg_v,
        "median_views": median_v,
        "engagement_rate": eng_rate,
        "raw_videos": items,
        "_user_id_tikhub": creator.get("user_id", ""),
    }


async def get_user_profile(handle: str) -> dict | None:
    """Fetch a TikTok user profile by handle.

    Returns the full userInfo dict: {user: {...}, stats: {...}}.
    Access user fields via result['user']['secUid'], result['user']['signature'], etc.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TIKHUB_BASE}/tiktok/web/fetch_user_profile",
            params={"uniqueId": handle},
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("data", {}).get("userInfo")


def _compute_avg_views(videos: list[dict]) -> int:
    """Compute average play count from a list of video items."""
    if not videos:
        return 0
    total = 0
    count = 0
    for v in videos:
        stats = v.get("stats") or v.get("statistics") or {}
        plays = (
            stats.get("playCount")
            or stats.get("play_count")
            or v.get("play_count")
            or 0
        )
        if plays:
            total += plays
            count += 1
    return round(total / count) if count else 0


def parse_profile_fields(user_info: dict | None) -> dict:
    """Extract fields from a userInfo dict, mapped to our DB schema columns.

    Returns keys: handle, bio, bio_link, cover_url, followers, avg_views, sec_uid.
    """
    if not user_info:
        return {
            "handle": "",
            "sec_uid": "",
            "bio": "",
            "bio_link": "",
            "cover_url": "",
            "followers": 0,
            "avg_views": 0,
            "total_likes": 0,
            "video_count": 0,
            "following_count": 0,
            "verified": False,
            "country_code": "",
            "nickname": "",
            "raw_profile": {},
        }
    user = user_info.get("user") or {}
    stats = user_info.get("stats") or {}
    bio_link_obj = user.get("bioLink") or {}
    return {
        "handle": user.get("uniqueId") or user.get("unique_id") or "",
        "sec_uid": user.get("secUid") or user.get("sec_uid") or "",
        "bio": user.get("signature") or "",
        "bio_link": bio_link_obj.get("link") or "",
        "cover_url": user.get("avatarLarger") or user.get("avatarMedium") or "",
        "followers": stats.get("followerCount") or stats.get("follower_count") or 0,
        "avg_views": 0,  # Will be computed separately via get_user_videos
        "total_likes": stats.get("heartCount") or stats.get("heart_count") or stats.get("heart") or 0,
        "video_count": stats.get("videoCount") or stats.get("video_count") or 0,
        "following_count": stats.get("followingCount") or stats.get("following_count") or 0,
        "verified": user.get("verified") or False,
        "country_code": user.get("region") or "",
        "nickname": user.get("nickname") or "",
        "raw_profile": user_info,
    }


async def parse_profile_fields_with_avg_views(user_info: dict | None) -> dict:
    """Like parse_profile_fields but also fetches videos to compute avg_views."""
    profile = parse_profile_fields(user_info)
    if profile["sec_uid"]:
        videos = await get_user_videos(profile["sec_uid"], count=10)
        profile["avg_views"] = _compute_avg_views(videos)
    return profile


async def get_user_videos(sec_uid: str, count: int = 10) -> list[dict]:
    """Fetch recent videos for a user by sec_uid."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TIKHUB_BASE}/tiktok/app/v3/fetch_user_post_videos",
            params={"sec_user_id": sec_uid, "max_cursor": 0, "count": count},
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        inner = data.get("data", {})
        # Handle multiple response shapes
        items = (inner.get("itemList")
                 or inner.get("item_list")
                 or inner.get("aweme_list")
                 or [])
        return items


async def get_similar_users(sec_uid: str) -> list[dict]:
    """Fetch similar creator recommendations.

    Returns a list of user dicts with fields like unique_id/uniqueId.
    """
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{TIKHUB_BASE}/tiktok/app/v3/fetch_similar_user_recommendations",
            params={"sec_uid": sec_uid},
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        inner = data.get("data", {}) if isinstance(data.get("data"), dict) else {}
        users = inner.get("users") or inner.get("user_list") or []
        # If data is a list directly
        if isinstance(data.get("data"), list):
            users = data["data"]
        return users


def parse_similar_user(user: dict) -> str:
    """Extract handle from a similar user dict."""
    return user.get("unique_id") or user.get("uniqueId") or ""


def parse_tiktok_handle(input_str: str) -> str:
    """Parse a TikTok handle from various input formats.

    Accepts:
    - @handle
    - handle
    - https://www.tiktok.com/@handle
    - https://www.tiktok.com/@handle/video/1234567
    - https://vt.tiktok.com/ZS.../ (short URLs - just extract what we can)

    Returns the clean handle without @.
    """
    input_str = input_str.strip()

    # Remove @ prefix
    if input_str.startswith("@"):
        return input_str[1:]

    # Parse TikTok URLs
    match = re.match(r'https?://(?:www\.|vm\.|vt\.)?tiktok\.com/@([^/?#]+)', input_str)
    if match:
        return match.group(1)

    # If it looks like a plain handle (no spaces, no slashes)
    if "/" not in input_str and " " not in input_str:
        return input_str

    return ""


async def search_creators_paginated(
    keyword: str,
    country: str = "US",
    sort_by: str = "avg_views",
    max_results: int = 50,
) -> list[dict]:
    """Search TikTok Creator Marketplace with auto-pagination.

    Fetches up to max_results creators across multiple pages.
    Uses limit=50 per page to maximize cost efficiency.
    """
    all_creators: list[dict] = []
    page = 1
    per_page = min(50, max_results)  # Try 50 per page for cost efficiency

    while len(all_creators) < max_results:
        try:
            creators = await search_creators(
                keyword, country=country, sort_by=sort_by,
                limit=per_page, page=page,
            )
        except Exception:
            # If limit=50 fails on first page, retry with 20
            if page == 1 and per_page > 20:
                per_page = 20
                try:
                    creators = await search_creators(
                        keyword, country=country, sort_by=sort_by,
                        limit=per_page, page=page,
                    )
                except Exception:
                    break
            else:
                break

        if not creators:
            break

        all_creators.extend(creators)

        # Check if we got fewer than requested (no more pages)
        if len(creators) < per_page:
            break

        page += 1

    return all_creators[:max_results]
