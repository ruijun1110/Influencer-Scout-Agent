import asyncio
import logging
import re

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# TikHub may enforce ~1 request/s per route on ``fetch_search_video`` (see 429 JSON).
WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S = 1.0


class RateLimiter:
    """Token-bucket style limiter — at most 1 request per ``interval`` seconds."""

    def __init__(self, rps: float = 1.0):
        self._interval = 1.0 / rps
        self._lock: asyncio.Lock | None = None
        self._last = 0.0

    def _get_lock(self) -> asyncio.Lock:
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def acquire(self):
        async with self._get_lock():
            loop = asyncio.get_event_loop()
            now = loop.time()
            wait = self._last + self._interval - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._last = asyncio.get_event_loop().time()


async def _request_with_retry(
    client: "httpx.AsyncClient",
    method: str,
    url: str,
    *,
    max_retries: int = 3,
    **kwargs,
) -> "httpx.Response":
    """Make an HTTP request with automatic retry on 429 Too Many Requests."""
    for attempt in range(max_retries + 1):
        await _rate_limiter.acquire()
        resp = await client.request(method, url, **kwargs)
        if resp.status_code == 429 and attempt < max_retries:
            wait = 2 ** attempt  # 1s, 2s, 4s
            logger.warning("429 from %s, retrying in %ds (attempt %d/%d)", url.split("?")[0], wait, attempt + 1, max_retries)
            await asyncio.sleep(wait)
            continue
        resp.raise_for_status()
        return resp
    return resp  # unreachable but satisfies type checker


_rate_limiter = RateLimiter(rps=1.0)


def _api_base() -> str:
    return get_settings().tikhub_base_url.rstrip("/")


def _headers(api_key: str | None = None) -> dict:
    settings = get_settings()
    key = api_key or settings.tikhub_api_key
    return {"Authorization": f"Bearer {key}"}


def _extract_search_items(data: dict) -> list[dict]:
    """Try common response shapes to extract video item list from search.

    Covers: web ``fetch_search_video`` (itemList/data), app v3 ``fetch_video_search_result``.

    TikTok app v3 search often returns **empty** ``aweme_list`` but real rows under
    ``search_item_list`` (each element has ``aweme_info``). We only accept **non-empty**
    lists so an empty ``aweme_list`` does not mask ``search_item_list``.
    """
    if not isinstance(data, dict):
        return []
    # Some TikHub routes return the list directly under ``data`` (array).
    top_data = data.get("data")
    if isinstance(top_data, list) and top_data:
        return top_data
    inner = data.get("data", {})
    if not isinstance(inner, dict):
        return []
    for key in (
        "data",
        "itemList",
        "item_list",
        "aweme_list",
        "awemeList",
        "videos",
        "items",
        "search_item_list",
    ):
        items = inner.get(key)
        if isinstance(items, list) and items:
            return items
    # Nested data.data (some TikHub wrappers)
    nested = inner.get("data")
    if isinstance(nested, list) and nested:
        return nested
    if isinstance(nested, dict):
        for key in (
            "data",
            "itemList",
            "item_list",
            "aweme_list",
            "awemeList",
            "items",
            "search_item_list",
        ):
            items = nested.get(key)
            if isinstance(items, list) and items:
                return items
    return []


def _extract_video_author(item: dict) -> dict:
    """Extract author info from a search result item.

    The item may have an 'item' wrapper (web), or be an app/aweme dict with ``author`` at top level.
    """
    video = item.get("item") or item.get("aweme_info") or item
    author = video.get("author") or video.get("author_info") or {}
    stats = video.get("stats") or video.get("statistics") or {}
    return {
        "handle": author.get("uniqueId") or author.get("unique_id") or "",
        "sec_uid": author.get("secUid") or author.get("sec_uid") or "",
        "play_count": stats.get("playCount") or stats.get("play_count") or 0,
        "video_id": str(video.get("id") or video.get("aweme_id") or ""),
    }


def _first_url_in_cover_like(block: object) -> str | None:
    if not isinstance(block, dict):
        return None
    for k in ("url_list", "urlList"):
        lst = block.get(k)
        if isinstance(lst, list) and lst and isinstance(lst[0], str):
            return lst[0]
    return None


def _cover_url_from_video_subtree(video: dict) -> str | None:
    """TikTok ``video`` object: cover / dynamic_cover / … with ``url_list``."""
    if not isinstance(video, dict):
        return None
    for name in ("cover", "dynamic_cover", "origin_cover", "share_cover", "animated_cover"):
        u = _first_url_in_cover_like(video.get(name))
        if u:
            return u
    return None


def extract_video_item_cover_url(item: dict) -> str | None:
    """First frame URL from a video search row (web ``item`` or app ``search_item_list``)."""
    if not isinstance(item, dict):
        return None
    aweme = item.get("aweme_info") or item.get("item") or item
    if not isinstance(aweme, dict):
        return None
    vid = aweme.get("video")
    if isinstance(vid, dict):
        u = _cover_url_from_video_subtree(vid)
        if u:
            return u
    for name in ("cover", "dynamic_cover"):
        u = _first_url_in_cover_like(aweme.get(name))
        if u:
            return u
    return None


def extract_marketplace_creator_cover_url(creator: dict) -> str | None:
    """Best-effort cover from Creator Marketplace ``search_creators`` creator payload."""
    items = creator.get("items")
    if not isinstance(items, list) or not items:
        return None

    def _vv(it: dict) -> int:
        v = it.get("vv") or it.get("view_count") or it.get("play_count") or 0
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    best = max(items, key=_vv)
    for key in ("cover_url", "video_cover_url", "thumbnail_url", "thumb_url", "avatar_url"):
        val = best.get(key)
        if isinstance(val, str) and val.startswith("http"):
            return val
    for nested_key in ("video", "video_info", "aweme", "item"):
        nested = best.get(nested_key)
        if isinstance(nested, dict):
            u = _cover_url_from_video_subtree(nested.get("video") or nested)
            if u:
                return u
    return None


def extract_trigger_video_url(creator_or_item: dict, handle: str) -> str | None:
    """Extract the best video URL from a marketplace creator or search item.

    Returns a TikTok video URL like https://www.tiktok.com/@handle/video/12345
    """
    # For marketplace creators (search_creators response)
    items = creator_or_item.get("items")
    if isinstance(items, list) and items:
        # Pick the best video (highest views)
        def _vv(it: dict) -> int:
            v = it.get("vv") or it.get("view_count") or it.get("play_count") or 0
            try:
                return int(v)
            except (TypeError, ValueError):
                return 0

        best = max(items, key=_vv)
        # Try tt_link first
        tt = best.get("tt_link") or best.get("video_url")
        if isinstance(tt, str) and tt.startswith("http"):
            return tt
        # Try constructing from video_id
        vid = str(best.get("id") or best.get("video_id") or best.get("aweme_id") or "")
        if vid and handle:
            return f"https://www.tiktok.com/@{handle}/video/{vid}"

    # For video search items (single video)
    video = creator_or_item.get("item") or creator_or_item.get("aweme_info") or creator_or_item
    vid = str(video.get("id") or video.get("aweme_id") or "")
    if vid and handle:
        author = video.get("author") or video.get("author_info") or {}
        h = author.get("uniqueId") or author.get("unique_id") or handle
        return f"https://www.tiktok.com/@{h}/video/{vid}"

    return None


async def _fetch_video_search_app_v3(
    client: httpx.AsyncClient, keyword: str, count: int, offset: int,
    region: str = "US", api_key: str | None = None,
) -> dict:
    """TikTok app v3 video search — offset/count/sort_type/region."""
    params: dict = {
        "keyword": keyword,
        "offset": offset,
        "count": count,
        "sort_type": 0,
        "publish_time": 0,
    }
    if region:
        params["region"] = region
    resp = await client.get(
        f"{_api_base()}/tiktok/app/v3/fetch_video_search_result",
        params=params,
        headers=_headers(api_key),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _http_error_detail(exc: httpx.HTTPStatusError) -> str:
    r = exc.response
    body = (r.text or "").strip()[:500]
    ra = r.headers.get("Retry-After", "")
    parts = [f"status={r.status_code}"]
    if ra:
        parts.append(f"retry_after={ra}")
    if body:
        parts.append(f"body={body}")
    else:
        parts.append("body=(empty)")
    return " ".join(parts)


def _retry_after_seconds(response: httpx.Response) -> float:
    ra = response.headers.get("Retry-After")
    if ra:
        try:
            return max(float(ra), WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S)
        except ValueError:
            pass
    return WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S


async def search_videos(keyword: str, count: int = 20, offset: int = 0, region: str = "US", api_key: str | None = None) -> dict:
    """Search TikTok videos by keyword.

    Order (TikHub docs + observed limits):

    1. **Legacy web** — ``keyword``, ``count``, ``offset`` (documented for
       ``fetch_search_video``). No ``cursor``+``count`` combo (often returns 400).
    2. **Web VideoSearch-style** — ``cursor`` + string filters only (no ``count`` on
       that shape). At least ``WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S`` after any prior
       hit to the same path (route limit ~1 req/s).
    3. **App v3** — ``fetch_video_search_result``. Brief pause before first app call
       if we just used the web route.

    On **429** for a web shape: wait (``Retry-After`` or min gap), **retry that shape
    once**, then fall through to app v3 if still failing.
    """
    url = f"{_api_base()}/tiktok/web/fetch_search_video"
    legacy_params = {"keyword": keyword, "count": count, "offset": offset}
    cursor_params = {
        "keyword": keyword,
        "sort_type": "0",
        "publish_time": "0",
        "filter_duration": "0",
        "content_type": "0",
        "search_id": "",
        "cursor": offset,
    }
    web_shapes: list[tuple[str, dict]] = [
        ("legacy_count_offset", legacy_params),
        ("web_cursor_filters", cursor_params),
    ]

    last_err: httpx.HTTPStatusError | None = None

    async def _web_get(client: httpx.AsyncClient, params: dict) -> dict:
        resp = await client.get(
            url, params=params, headers=_headers(api_key), timeout=30
        )
        resp.raise_for_status()
        return resp.json()

    async with httpx.AsyncClient() as client:
        for attempt_idx, (shape_name, params) in enumerate(web_shapes):
            if attempt_idx > 0:
                await asyncio.sleep(WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S)

            try:
                data = await _web_get(client, params)
                n = len(_extract_search_items(data))
                logger.info(
                    "tikhub video search ok route=web shape=%s keyword=%r items=%d",
                    shape_name,
                    keyword,
                    n,
                )
                return data
            except httpx.HTTPStatusError as e:
                last_err = e
                code = e.response.status_code
                if code == 429:
                    delay = _retry_after_seconds(e.response)
                    logger.warning(
                        "tikhub fetch_search_video 429, retrying same shape after %.1fs: %s",
                        delay,
                        _http_error_detail(e),
                    )
                    await asyncio.sleep(delay)
                    try:
                        data = await _web_get(client, params)
                        n = len(_extract_search_items(data))
                        logger.info(
                            "tikhub video search ok route=web shape=%s (after 429) "
                            "keyword=%r items=%d",
                            shape_name,
                            keyword,
                            n,
                        )
                        return data
                    except httpx.HTTPStatusError as e2:
                        last_err = e2
                        logger.warning(
                            "tikhub web shape=%s retry failed, using app/v3: %s",
                            shape_name,
                            _http_error_detail(e2),
                        )
                        break
                elif code in (400, 404, 422):
                    logger.warning(
                        "tikhub fetch_search_video rejected shape=%s: %s",
                        shape_name,
                        _http_error_detail(e),
                    )
                    continue
                raise

        await asyncio.sleep(WEB_FETCH_SEARCH_VIDEO_MIN_GAP_S)
        try:
            data = await _fetch_video_search_app_v3(client, keyword, count, offset, region=region, api_key=api_key)
            n = len(_extract_search_items(data))
            if n == 0:
                sub = data.get("data") if isinstance(data, dict) else None
                sub_keys = list(sub.keys()) if isinstance(sub, dict) else type(sub).__name__
                logger.warning(
                    "tikhub app_v3 HTTP OK but 0 video items parsed for keyword=%r "
                    "(web search returned 400 earlier). top_keys=%s data subtree=%s — "
                    "TikHub payload shape may have changed; check raw JSON or TikHub support.",
                    keyword,
                    list(data.keys()) if isinstance(data, dict) else None,
                    sub_keys,
                )
            logger.info(
                "tikhub video search ok route=app_v3 keyword=%r items=%d",
                keyword,
                n,
            )
            return data
        except httpx.HTTPStatusError as app_exc:
            logger.warning(
                "tikhub app/v3 fetch_video_search_result failed: %s",
                _http_error_detail(app_exc),
            )
            raise app_exc from last_err


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


def _parse_search_creators_payload(data: dict) -> tuple[list[dict], bool]:
    """Normalize TikHub search_creators JSON to (creators, has_more)."""
    inner = data.get("data", {})
    if isinstance(inner, dict):
        inner = inner.get("data", inner)
    if not isinstance(inner, dict):
        return [], False
    creators = inner.get("creators", [])
    pagination = inner.get("pagination") or {}
    has_more = bool(pagination.get("has_more", False))
    return creators, has_more


async def search_creators(
    keyword: str,
    country: str = "US",
    sort_by: str = "avg_views",
    limit: int = 20,
    page: int = 1,
    api_key: str | None = None,
) -> tuple[list[dict], bool]:
    """Search TikTok Creator Marketplace for creators by keyword.

    Returns (creators, has_more). On 400/422, retries with ``sort_by=follower`` and capped
    ``limit`` (TikHub docs: ``follower`` | ``avg_views``; some gateways reject high limits).
    """
    url = f"{_api_base()}/tiktok/ads/search_creators"
    attempts: list[dict] = [
        {
            "keyword": keyword,
            "page": page,
            "limit": limit,
            "sort_by": sort_by,
            "creator_country": country,
        },
    ]
    if sort_by != "follower":
        attempts.append(
            {
                "keyword": keyword,
                "page": page,
                "limit": min(limit, 20),
                "sort_by": "follower",
                "creator_country": country,
            }
        )
    if limit > 20:
        attempts.append(
            {
                "keyword": keyword,
                "page": page,
                "limit": 20,
                "sort_by": sort_by,
                "creator_country": country,
            }
        )

    last_err: httpx.HTTPStatusError | None = None
    async with httpx.AsyncClient() as client:
        for params in attempts:
            try:
                resp = await _request_with_retry(
                    client, "GET", url,
                    params=params, headers=_headers(api_key), timeout=30,
                )
                return _parse_search_creators_payload(resp.json())
            except httpx.HTTPStatusError as e:
                last_err = e
                if e.response.status_code in (400, 404, 422):
                    continue
                raise
        if last_err:
            raise last_err
        return [], False


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


async def get_user_profile(handle: str, api_key: str | None = None) -> dict | None:
    """Fetch a TikTok user profile by handle via app v3 endpoint.

    Returns a dict with {user: {...}, stats: {...}} structure.
    Falls back to web endpoint if v3 fails.
    """
    async with httpx.AsyncClient() as client:
        # Try app v3 first (more stable, fewer 429s)
        try:
            resp = await _request_with_retry(
                client, "GET",
                f"{_api_base()}/tiktok/app/v3/handler_user_profile",
                params={"unique_id": handle},
                headers=_headers(api_key),
                timeout=30,
            )
            data = resp.json()
            inner = data.get("data", {})
            # v3 may nest under "user" directly or have userInfo wrapper
            if "userInfo" in inner:
                return inner["userInfo"]
            if "user" in inner:
                return inner
            logger.warning("v3 handler_user_profile unexpected shape for @%s, falling back to web", handle)
        except Exception as e:
            logger.warning("v3 handler_user_profile failed for @%s: %s, falling back to web", handle, e)

        # Fallback to web endpoint
        resp = await _request_with_retry(
            client, "GET",
            f"{_api_base()}/tiktok/web/fetch_user_profile",
            params={"uniqueId": handle},
            headers=_headers(api_key),
            timeout=30,
        )
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


async def parse_profile_fields_with_avg_views(user_info: dict | None, api_key: str | None = None) -> dict:
    """Like parse_profile_fields but also fetches videos to compute avg_views and engagement_rate."""
    profile = parse_profile_fields(user_info)
    if profile["sec_uid"]:
        videos = await get_user_videos(profile["sec_uid"], count=10, api_key=api_key)
        profile["avg_views"] = _compute_avg_views(videos)

        # Compute engagement_rate from video stats
        total_views = 0
        total_likes = 0
        for v in videos:
            stats = v.get("statistics") or v.get("stats") or {}
            plays = stats.get("playCount") or stats.get("play_count") or 0
            likes = stats.get("diggCount") or stats.get("digg_count") or 0
            total_views += plays
            total_likes += likes

        profile["engagement_rate"] = round(total_likes / total_views, 4) if total_views > 0 else 0

        # Extract top 3 videos by play count
        top_videos = []
        sorted_by_views = sorted(
            videos,
            key=lambda v: (v.get("statistics") or v.get("stats") or {}).get("playCount") or (v.get("statistics") or v.get("stats") or {}).get("play_count") or 0,
            reverse=True,
        )
        for v in sorted_by_views[:3]:
            stats = v.get("statistics") or v.get("stats") or {}
            vid_id = str(v.get("id") or v.get("aweme_id") or "")
            if not vid_id:
                continue
            # Extract cover URL using proven helpers that handle all TikHub response shapes
            cover = _cover_url_from_video_subtree(v.get("video") or {})
            if not cover:
                # Fallback: cover/dynamic_cover at top level (some app v3 shapes)
                cover = _first_url_in_cover_like(v.get("cover")) or _first_url_in_cover_like(v.get("dynamic_cover"))
            top_videos.append({
                "video_id": vid_id,
                "desc": (v.get("desc") or "")[:100],
                "play_count": stats.get("playCount") or stats.get("play_count") or 0,
                "digg_count": stats.get("diggCount") or stats.get("digg_count") or 0,
                "cover_url": cover,
            })
        profile["top_videos"] = top_videos
    else:
        profile["engagement_rate"] = 0
    return profile


async def get_user_videos(sec_uid: str, count: int = 10, api_key: str | None = None) -> list[dict]:
    """Fetch recent videos for a user by sec_uid."""
    async with httpx.AsyncClient() as client:
        resp = await _request_with_retry(
            client, "GET",
            f"{_api_base()}/tiktok/app/v3/fetch_user_post_videos",
            params={"sec_user_id": sec_uid, "max_cursor": 0, "count": count},
            headers=_headers(api_key),
            timeout=30,
        )
        data = resp.json()
        inner = data.get("data", {})
        # Handle multiple response shapes
        items = (inner.get("itemList")
                 or inner.get("item_list")
                 or inner.get("aweme_list")
                 or [])
        return items


async def get_similar_users(sec_uid: str, api_key: str | None = None) -> list[dict]:
    """Fetch similar creator recommendations (query param ``sec_uid``, not ``sec_user_id``)."""
    async with httpx.AsyncClient() as client:
        resp = await _request_with_retry(
            client, "GET",
            f"{_api_base()}/tiktok/app/v3/fetch_similar_user_recommendations",
            params={"sec_uid": sec_uid},
            headers=_headers(api_key),
            timeout=30,
        )

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
    api_key: str | None = None,
) -> list[dict]:
    """Search TikTok Creator Marketplace with auto-pagination.

    Fetches up to max_results creators across multiple pages.
    Uses limit=50 per page to maximize cost efficiency.
    Stops when the API reports has_more=False.
    """
    all_creators: list[dict] = []
    page = 1
    per_page = min(50, max_results)  # Try 50 per page for cost efficiency

    while len(all_creators) < max_results:
        try:
            creators, has_more = await search_creators(
                keyword, country=country, sort_by=sort_by,
                limit=per_page, page=page, api_key=api_key,
            )
        except Exception:
            # If limit=50 fails on first page, retry with 20
            if page == 1 and per_page > 20:
                per_page = 20
                try:
                    creators, has_more = await search_creators(
                        keyword, country=country, sort_by=sort_by,
                        limit=per_page, page=page, api_key=api_key,
                    )
                except Exception:
                    break
            else:
                break

        if not creators:
            break

        all_creators.extend(creators)

        if not has_more:
            break

        page += 1

    return all_creators[:max_results]
