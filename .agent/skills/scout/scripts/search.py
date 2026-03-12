#!/usr/bin/env python3
from __future__ import annotations
"""
search.py — Phase 1: search TikTok for videos by keyword via TikHub API.

Response shape (fetch_search_video):
  data['data']['data'] → list of video items   OR
  data['data']['itemList'] → list of video items
  item['item']['author']['uniqueId']  → handle
  item['item']['author']['secUid']    → sec_uid
  item['item']['stats']['playCount']  → play_count
"""
import logging
from datetime import date

import httpx
import excel

log = logging.getLogger('scout.search')

BASE_URL = "https://api.tikhub.io/api/v1"


def _tikhub_get(endpoint: str, params: dict, api_key: str) -> dict | None:
    """Make authenticated GET request to TikHub API."""
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


def _extract_items(resp) -> list:
    """Try common response shapes to extract video item list."""
    if not resp:
        return []
    data = resp.get('data') or {}
    items = data.get('data')
    if isinstance(items, list):
        return items
    items = data.get('itemList') or data.get('item_list')
    if isinstance(items, list):
        return items
    return []


def run_search(campaign_name: str, api_key: str, config: dict,
               keyword_filter: str | None = None) -> list[dict]:
    """Search all pending keywords. Returns list of candidate dicts."""
    keywords = excel.read_keywords(campaign_name)

    if keyword_filter:
        pending = [k for k in keywords
                   if k.get('keyword', '').strip().lower() == keyword_filter.strip().lower()
                   and k.get('status') == 'pending']
    else:
        pending = [k for k in keywords if k.get('status') == 'pending']

    if not pending:
        log.info("No pending keywords for campaign=%s", campaign_name)
        print("No pending keywords.")
        return []

    log.info("Starting search: campaign=%s, %d pending keywords", campaign_name, len(pending))
    all_candidates = []
    for kw_row in pending:
        keyword = kw_row['keyword']
        kw_candidates = _search_keyword(keyword, campaign_name, api_key, config)

        excel.mark_keyword_searched(campaign_name, keyword)
        excel.append_search_log({
            'keyword': keyword,
            'results_checked': kw_candidates[0].get('_results_checked', 0) if kw_candidates else 0,
            'candidates_found': len(kw_candidates),
            'qualified': '',
            'duration_mins': '',
            'campaign': campaign_name,
            'run_date': str(date.today()),
        })
        print(f"  [{keyword}] → {len(kw_candidates)} candidates")
        all_candidates.extend(kw_candidates)

    added = excel.append_candidates(all_candidates)
    print(f"Phase 1 complete: {len(all_candidates)} candidates found, {added} new written to sheet.")
    return all_candidates


def _search_keyword(keyword: str, campaign: str, api_key: str, config: dict) -> list[dict]:
    view_threshold = config.get('view_threshold', 10000)
    max_candidates = config.get('max_candidates_per_keyword', 5)
    log.info("Searching keyword=%r view_threshold=%d max_candidates=%d", keyword, view_threshold, max_candidates)

    results = []
    offset = 0
    results_checked = 0
    seen_handles = set()

    while len(results) < max_candidates:
        resp = _tikhub_get(
            'tiktok/web/fetch_search_video',
            {'keyword': keyword, 'count': 20, 'offset': offset},
            api_key,
        )

        items = _extract_items(resp)
        if not items:
            break

        results_checked += len(items)

        for item in items:
            video = _safe_get(item, 'item') or item
            author = _safe_get(video, 'author') or {}
            stats = _safe_get(video, 'stats') or {}

            handle = author.get('uniqueId') or author.get('unique_id') or ''
            sec_uid = author.get('secUid') or author.get('sec_uid') or ''
            play_count = stats.get('playCount') or stats.get('play_count') or 0
            video_id = video.get('id') or ''

            if not handle or handle in seen_handles:
                continue
            if play_count < view_threshold:
                continue

            log.info("Candidate found: @%s play_count=%d keyword=%r", handle, play_count, keyword)
            seen_handles.add(handle)
            results.append({
                'handle': handle,
                '_sec_uid': sec_uid,
                'triggering_video_url': f'https://www.tiktok.com/@{handle}/video/{video_id}',
                'triggering_play_count': play_count,
                'keyword': keyword,
                'campaign': campaign,
                'audit_status': 'pending',
                '_results_checked': results_checked,
            })

            if len(results) >= max_candidates:
                break

        has_more = _safe_get(resp, 'data', 'has_more')
        if not has_more:
            break
        offset += len(items)

    if results:
        results[0]['_results_checked'] = results_checked

    return results
