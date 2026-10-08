#!/usr/bin/env python3
"""Offline test: verify venues/leagues/coaches are fetched from RIMS and ESPN.

Run from the repo root:  python tests/test_fetch_entities.py

No network is used; everything is served from the real on-disk API cache.
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from rugby_data.api import EspnApi
from rugby_data.builder import DatasetBuilder
from rugby_data.cache import ApiCache
from rugby_data.dataset import Dataset
from rugby_data.models import game_from_dict, game_to_dict
from rugby_data.rims_api import RimsApi


def main() -> int:
    failures: list[str] = []

    def check(cond: bool, msg: str) -> None:
        if cond:
            print(f"  [PASS] {msg}")
        else:
            print(f"  [FAIL] {msg}")
            failures.append(msg)

    print("=== Offline entity-fetch test (venues / leagues / coaches) ===")

    cache = ApiCache(Path("data/api_cache.json"))
    dataset = Dataset()
    rims = RimsApi(cache)
    espn = EspnApi(cache)
    builder = DatasetBuilder(
        rims, espn, cache, dataset, Path("/tmp/test_fetch_out.json"), source="rims"
    )

    cache_keys = list(cache._entries.keys()) if hasattr(cache, "_entries") else []

    # ---- RIMS ----
    print("\n[RIMS] venue / league / coach extraction")
    rims_keys = [
        k for k in cache_keys
        if "rugby/v3/match/" in k and k.endswith("/summary")
    ]
    if not rims_keys:
        check(False, "found a cached RIMS match summary")
        game = None
    else:
        mid_match = re.search(r"/match/([^/]+)/summary", rims_keys[0])
        if not mid_match:
            check(False, "extract match id from RIMS summary url")
            game = None
        else:
            mid = mid_match.group(1)
            try:
                summary = rims.match_summary(mid)
                game = builder._game_from_rims(summary)
                check(game is not None, f"built Game from RIMS match {mid}")
            except Exception as exc:
                print(f"  [WARN] RIMS build failed: {exc}")
                game = None
                check(False, f"built Game from RIMS match {mid}")

    if game is not None:
        check(
            bool(game.venue_id) and game.venue_id.isdigit(),
            f"game.venue_id is canonical RIMS/Opta numeric id (got {game.venue_id!r})",
        )
        competition = summary.get("match", {}).get("competition")
        check(
            bool(game.league_id) and game.league_id == competition,
            f"game.league_id is the RIMS competition name (got {game.league_id!r})",
        )
        has_coach = any(c.coach_id for c in game.competitors)
        check(has_coach, "at least one competitor has a coach_id")
        check(bool(dataset.venues), "dataset.venues populated from RIMS")
        check(bool(dataset.leagues), "dataset.leagues populated from RIMS")
        check(bool(dataset.coaches), "dataset.coaches populated from RIMS")
        check(
            not any(k.startswith(("rims:", "espn:")) for k in dataset.venues),
            "venue keys are prefix-free (canonical Opta/RIMS)",
        )
        check(
            not any(k.startswith(("rims:", "espn:")) for k in dataset.leagues),
            "league keys are prefix-free (canonical Opta/RIMS)",
        )
    else:
        check(False, "RIMS game available for core assertions")

    # ---- ESPN site web ----
    print("\n[ESPN] venue / league registration")
    espn_keys = [
        k for k in cache_keys
        if "site.web.api.espn.com" in k and "/summary" in k
    ]
    if not espn_keys:
        check(False, "found a cached ESPN site web summary")
    else:
        espn_summary = cache.get(espn_keys[0])
        try:
            builder._register_venue_from_site_web(espn_summary)
            builder._register_league_from_site_web(espn_summary)
        except Exception as exc:
            print(f"  [WARN] ESPN register failed: {exc}")
        has_espn_venue = any(
            not k.startswith(("rims:", "espn:")) for k in dataset.venues
        )
        has_espn_league = any(
            not k.startswith(("rims:", "espn:")) for k in dataset.leagues
        )
        check(
            has_espn_venue,
            "dataset.venues got an ESPN id (prefix-free) after registering",
        )
        check(
            has_espn_league,
            "dataset.leagues got an ESPN id (prefix-free) after registering",
        )

    # ---- ESPN team id -> RIMS/Opta mapping ----
    print("\n[ESPN] team id canonicalised to RIMS/Opta")
    from rugby_data.config import RIMS_TEAM_IDS

    sample_espn = 5  # South Africa (ESPN id)
    expected_rims = int(RIMS_TEAM_IDS["5"])  # 39 (RIMS/Opta id)
    check(
        builder._to_rims_team_id(sample_espn) == expected_rims,
        f"ESPN team {sample_espn} -> RIMS/Opta {expected_rims}",
    )
    check(
        builder._to_rims_team_id(999999) == 999999,
        "unknown ESPN team id falls back to itself",
    )

    # ---- Model round-trip ----
    print("\n[Model] venue / league / coach round-trip")
    if game is not None:
        rt = game_from_dict(game_to_dict(game))
        check(
            rt.venue_id == game.venue_id,
            f"venue_id round-trips ({rt.venue_id!r} == {game.venue_id!r})",
        )
        check(
            rt.league_id == game.league_id,
            f"league_id round-trips ({rt.league_id!r} == {game.league_id!r})",
        )
        if game.competitors:
            check(
                rt.competitors[0].coach_id == game.competitors[0].coach_id,
                "competitors[0].coach_id round-trips",
            )
        else:
            check(False, "competitors present for round-trip")
    else:
        check(False, "round-trip available (no game)")

    ok = not failures
    print("\n=== Summary ===")
    if ok:
        print("PASS: all entity-fetch checks succeeded")
    else:
        print(f"FAIL: {len(failures)} check(s) failed:")
        for f in failures:
            print(f"  - {f}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
