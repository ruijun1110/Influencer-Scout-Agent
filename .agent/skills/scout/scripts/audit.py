#!/usr/bin/env python3
from __future__ import annotations
"""
audit.py — Phase 2: profile audit via TikHub API.

Fetches recent videos for each candidate and checks view counts
against thresholds to determine qualification.
"""
import logging
import statistics
from datetime import date

import httpx
import excel

log = logging.getLogger('scout.audit')

BASE_URL = "https://api.tikhub.io/api/v1"


def _tikhub_get(endpoint: str, params: dict, api_key: str) -> dict | None:
    url = f"{BASE_URL}/{endpoint}"
    log.debug("GET %s params=%s", url, params)
    try:
        resp = httpx.get(
            url,
            params=params,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        log.debug("Response %s status=%d", endpoint, resp.status_code)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.error("TikHub API error (%s): %s", endpoint, e)
        return None


def _safe_get(obj, *keys):
    for key in keys:
        if obj is None:
            return None
        if isinstance(key, int):
            obj = obj[key] if isinstance(obj, list) and len(obj) > key else None
        else:
            obj = obj.get(key) if isinstance(obj, dict) else None
    return obj


def audit_handle(handle: str, campaign_name: str, api_key: str, config: dict, notes: str = '') -> dict:
    """Audit a single handle directly against a campaign's thresholds.
    Does not read from or write to the Candidates sheet — caller handles that.
    Returns same result dict as _audit_creator, with optional notes injected."""
    min_video_views = config.get('min_video_views', config.get('view_threshold', 10000))
    recent_video_count = config.get('recent_video_count', 10)

    log.info("Auditing @%s for campaign=%s min_video_views=%d", handle, campaign_name, min_video_views)

    candidate = {
        'handle': handle,
        'keyword': '',
        'triggering_video_url': '',
        'triggering_play_count': '',
    }
    result = _audit_creator(handle, '', candidate, api_key, min_video_views, recent_video_count, campaign_name)

    if notes and result.get('influencer_row'):
        existing_notes = result['influencer_row'].get('notes', '')
        result['influencer_row']['notes'] = (notes + ' — ' + existing_notes) if existing_notes else notes

    return result


def run_audit(candidates: list[dict], campaign_name: str, api_key: str, config: dict) -> dict:
    """Audit all candidates. Returns summary dict."""
    min_video_views = config.get('min_video_views', config.get('view_threshold', 10000))
    recent_video_count = config.get('recent_video_count', 10)

    qualified = 0
    errors = 0
    qualified_urls = []

    log.info("Starting audit: campaign=%s min_video_views=%d recent_video_count=%d",
             campaign_name, min_video_views, recent_video_count)
    all_pending = excel.get_pending_candidates(campaign_name)
    sec_uid_map = {c['handle']: c.get('_sec_uid', '') for c in candidates}
    for c in all_pending:
        if not c.get('_sec_uid'):
            c['_sec_uid'] = sec_uid_map.get(c.get('handle', ''), '')

    for candidate in all_pending:
        handle = candidate.get('handle', '')
        sec_uid = candidate.get('_sec_uid', '')

        try:
            result = _audit_creator(
                handle, sec_uid, candidate, api_key,
                min_video_views, recent_video_count, campaign_name,
            )
            if result.get('qualified'):
                qualified += 1
                excel.append_influencer(result['influencer_row'])
                qualified_urls.append(f"https://www.tiktok.com/@{handle}")
            status = 'qualified' if result.get('qualified') else 'not_qualified'
            excel.update_candidate_status(handle, campaign_name, status)
            print(f"  [{handle}] → {status}")
        except Exception as e:
            errors += 1
            excel.update_candidate_status(handle, campaign_name, 'error')
            print(f"  [{handle}] → error: {e}")

    return {
        'total': len(all_pending),
        'qualified': qualified,
        'errors': errors,
        'not_qualified': len(all_pending) - qualified - errors,
        'qualified_urls': qualified_urls,
    }


def _audit_creator(handle, sec_uid, candidate, api_key,
                   min_video_views, recent_video_count, campaign):
    """Fetch recent videos, compute stats, return result dict."""
    # If no sec_uid from search, fetch profile to get it
    if not sec_uid:
        profile_resp = _tikhub_get(
            'tiktok/web/fetch_user_profile',
            {'uniqueId': handle},
            api_key,
        )
        sec_uid = _safe_get(profile_resp, 'data', 'userInfo', 'user', 'secUid') or ''
        if not sec_uid:
            raise ValueError(f"Could not get sec_uid for @{handle}")

    posts_resp = _tikhub_get(
        'tiktok/app/v3/fetch_user_post_videos',
        {'sec_user_id': sec_uid, 'max_cursor': 0, 'count': recent_video_count},
        api_key,
    )

    items = (_safe_get(posts_resp, 'data', 'itemList')
             or _safe_get(posts_resp, 'data', 'item_list')
             or _safe_get(posts_resp, 'data', 'aweme_list')
             or [])

    play_counts = []
    for item in items:
        s = item.get('stats') or item.get('statistics') or {}
        pc = s.get('playCount') or s.get('play_count') or s.get('play_count', 0) or 0
        play_counts.append(pc)

    log.info("@%s fetched %d videos, play_counts=%s", handle, len(items), play_counts)

    if not play_counts:
        log.warning("@%s no play counts found — marking not qualified", handle)
        return {'qualified': False}

    max_views = max(play_counts)
    min_views = min(play_counts)
    median_views = statistics.median(play_counts)
    is_qualified = all(p >= min_video_views for p in play_counts)
    log.info("@%s max=%d min=%d median=%d qualified=%s", handle, max_views, min_views, median_views, is_qualified)

    notes = f'sampled {len(play_counts)}/{recent_video_count} videos' if len(play_counts) < recent_video_count else ''

    return {
        'qualified': is_qualified,
        'influencer_row': {
            'handle': handle,
            'profile_url': f'https://www.tiktok.com/@{handle}',
            'max_views': max_views,
            'min_views': min_views,
            'median_views': median_views,
            'triggering_video_url': candidate.get('triggering_video_url', ''),
            'triggering_play_count': candidate.get('triggering_play_count', ''),
            'keyword': candidate.get('keyword', ''),
            'campaign': campaign,
            'scouted_date': str(date.today()),
            'bio': '',
            'bio_link': '',
            'emails': '',
            'notes': notes,
        },
    }
