#!/usr/bin/env python3
from __future__ import annotations
"""
lookup.py — Find creators similar to a given TikTok profile.

Uses TikHub API: fetch_user_profile → fetch_similar_user_recommendations
Enriches each similar user and writes to Similar Users sheet.
"""
import logging
from datetime import date

import httpx
import excel
import enrich as enrich_mod

log = logging.getLogger('scout.lookup')

BASE_URL = "https://api.tikhub.io/api/v1"


def _tikhub_get(endpoint: str, params: dict, api_key: str) -> dict | None:
    try:
        resp = httpx.get(
            f"{BASE_URL}/{endpoint}",
            params=params,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        log.error("TikHub API error (%s): %s", endpoint, e)
        raise


def get_sec_uid(handle: str, api_key: str) -> str:
    payload = _tikhub_get('tiktok/web/fetch_user_profile', {'uniqueId': handle}, api_key)
    inner = payload.get('data', {})
    status = inner.get('statusCode', -1)
    if status != 0:
        raise ValueError(f"TikTok account @{handle} not found (statusCode={status})")
    sec_uid = inner.get('userInfo', {}).get('user', {}).get('secUid')
    if not sec_uid:
        raise ValueError(f"Could not extract sec_uid for @{handle}")
    return sec_uid


def get_similar_users(sec_uid: str, api_key: str) -> list[dict]:
    data = _tikhub_get(
        'tiktok/app/v3/fetch_similar_user_recommendations',
        {'sec_uid': sec_uid},
        api_key,
    )
    inner = data.get('data', {}) if data else {}
    user_list = inner.get('users') or inner.get('user_list') or []
    log.info("Similar users for sec_uid=%s: %d found", sec_uid, len(user_list))
    return user_list


def run_lookup(handle: str, api_key: str, requested_by: str = 'cli'):
    """Find similar creators, enrich them, write to xlsx."""
    log.info("Starting lookup for @%s requested_by=%s", handle, requested_by)
    print(f"Looking up similar creators for @{handle}...")

    sec_uid = get_sec_uid(handle, api_key)
    users = get_similar_users(sec_uid, api_key)

    if not users:
        print(f"No similar creators found for @{handle}.")
        return

    similar_handles = []
    for u in users:
        h = u.get('unique_id', '') or u.get('uniqueId', '')
        if h:
            similar_handles.append(h)

    print(f"Found {len(similar_handles)} similar creators. Enriching...")

    today = str(date.today())
    rows = []
    for h in similar_handles:
        try:
            enriched = enrich_mod.enrich_handle(h, api_key)
            email_str = ', '.join(enriched.get('emails', []))
            rows.append({
                'queried_handle': handle,
                'similar_handle': h,
                'profile_url': f'https://www.tiktok.com/@{h}',
                'bio': enriched.get('bio', ''),
                'bio_link': enriched.get('bio_link', ''),
                'emails': email_str,
                'lookup_date': today,
                'requested_by': requested_by,
            })
            email_count = len(enriched.get('emails', []))
            print(f"  @{h} — emails={email_count}")
        except Exception as e:
            rows.append({
                'queried_handle': handle,
                'similar_handle': h,
                'profile_url': f'https://www.tiktok.com/@{h}',
                'bio': '', 'bio_link': '', 'emails': '',
                'lookup_date': today,
                'requested_by': requested_by,
            })
            print(f"  @{h} — enrich error: {e}")

    added = excel.append_similar_users(rows)
    print(f"\nLookup complete: {len(rows)} similar to @{handle}, {added} new written to sheet.")
    print(f"Results in: {excel.XLSX_PATH}")

    # Print profile links
    print(f"\nSimilar to @{handle}:")
    for r in rows:
        print(f"  {r['profile_url']}")
