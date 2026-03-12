#!/usr/bin/env python3
from __future__ import annotations
"""
scout.py — Orchestrator for TikTok influencer scouting.

Pipeline: search → audit → enrich → write xlsx → generate dashboard
"""
import os
import sys

import excel
import search as search_mod
import audit as audit_mod
import enrich as enrich_mod
import dashboard as dashboard_mod


def run_scout(campaign_name: str, keyword: str | None = None):
    api_key = os.environ.get('TIKHUB_API_KEY', '')
    if not api_key:
        print("ERROR: TIKHUB_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    # If keyword given, append to keywords.md (deduped)
    if keyword:
        added = excel.append_keyword(campaign_name, keyword, source='cli')
        if not added:
            print(f'Keyword already exists: {keyword}')

    print(f"Scout: campaign={campaign_name}" + (f", keyword={keyword}" if keyword else ""))

    # Load config
    config = excel.load_config(campaign_name)
    print(f"Config: view_threshold={config['view_threshold']}, "
          f"min_video_views={config['min_video_views']}, "
          f"recent_video_count={config['recent_video_count']}, "
          f"max_candidates_per_keyword={config['max_candidates_per_keyword']}")

    # Phase 1 — Search
    print("\n--- Phase 1: Search ---")
    candidates = search_mod.run_search(
        campaign_name, api_key, config,
        keyword_filter=keyword,
    )

    if not candidates:
        print("No candidates found. Done.")
        return

    # Phase 2 — Audit
    print("\n--- Phase 2: Audit ---")
    summary = audit_mod.run_audit(candidates, campaign_name, api_key, config)

    # Phase 3 — Enrich qualified influencers
    print("\n--- Phase 3: Enrich ---")
    qualified_handles = []
    for url in summary.get('qualified_urls', []):
        # Extract handle from URL
        handle = url.rstrip('/').split('@')[-1]
        qualified_handles.append(handle)

    for handle in qualified_handles:
        try:
            result = enrich_mod.enrich_handle(handle, api_key)
            updates = {
                'bio': result.get('bio', ''),
                'bio_link': result.get('bio_link', ''),
                'emails': ', '.join(result.get('emails', [])),
            }
            excel.update_influencer(handle, campaign_name, updates)
            email_count = len(result.get('emails', []))
            print(f"  [{handle}] → bio_link={'yes' if result.get('bio_link') else 'no'}, "
                  f"emails={email_count}")
        except Exception as e:
            print(f"  [{handle}] → enrich error: {e}")

    # Report
    print(f"\n=== Scout Summary: {campaign_name} ===")
    print(f"  Candidates found:   {len(candidates)}")
    print(f"  Audited:            {summary['total']}")
    print(f"  Qualified:          {summary['qualified']}")
    print(f"  Not qualified:      {summary['not_qualified']}")
    print(f"  Errors:             {summary['errors']}")
    print(f"  Results written to: {excel.XLSX_PATH}")

    # Generate dashboard
    try:
        dashboard_mod.generate()
    except Exception as e:
        print(f"[dashboard] warning: {e}")
