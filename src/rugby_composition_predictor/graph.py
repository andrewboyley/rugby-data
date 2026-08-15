"""Builds a player co-occurrence graph from a Dataset.

Nodes are players; an undirected edge connects two players when they appear
in the same team's roster in the same match. Edge weight is the number of
shared matches.
"""

import json
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

from .config import (
    HOME_KIT_COLOURS,
    INTERNATIONAL_TEAM_IDS,
    RIMS_TEAM_IDS,
    SECONDARY_KIT_COLOURS,
)
from .dataset import Dataset
from .storage import atomic_write_text


def _team_out(info: object, espn_id: int | None) -> dict:
    """Emit a graph team record, preferring curated kit colours over any
    value carried by the raw dataset entry."""
    name = info.get("name") if isinstance(info, dict) else str(info)
    color = HOME_KIT_COLOURS.get(str(espn_id)) if espn_id is not None else None
    alt = SECONDARY_KIT_COLOURS.get(str(espn_id)) if espn_id is not None else None
    if color is None and isinstance(info, dict):
        color = info.get("color")
    if alt is None and isinstance(info, dict):
        alt = info.get("alternateColor")
    return {"name": name, "color": color, "alternateColor": alt}


class CoOccurrenceGraph:
    def __init__(self, dataset: Dataset, source: Path):
        self._dataset = dataset
        self._source = source

    def build_dict(self) -> dict:
        """Compute the graph and return its serializable form."""
        # Team ids in the dataset come from the RIMS API (e.g. 39 = South
        # Africa) while the curated colour/identity configs are keyed by ESPN
        # ids (e.g. 5 = South Africa). Normalise to ESPN ids for lookups and
        # restrict the graph to national (international) teams only.
        rims_to_es = {int(v): int(k) for k, v in RIMS_TEAM_IDS.items()}
        intl_es = {int(t) for t in INTERNATIONAL_TEAM_IDS}

        def to_espid(tid: int) -> int | None:
            if tid in rims_to_es:
                return rims_to_es[tid]
            if tid in intl_es:
                return tid
            return None

        def is_intl(tid: int) -> bool:
            return to_espid(tid) in intl_es

        weights: dict[tuple[str, str], int] = defaultdict(int)
        edge_dates: dict[tuple[str, str], set] = defaultdict(set)
        appearances: dict[str, int] = defaultdict(int)
        player_dates: dict[str, set] = defaultdict(set)
        team_counts: dict[str, Counter] = defaultdict(Counter)
        team_player_dates: dict[str, dict[int, set]] = defaultdict(
            lambda: defaultdict(set)
        )
        jersey_counts: dict[str, Counter] = defaultdict(Counter)

        for game in self._dataset.games:
            date = (game.date or "")[:10]
            intl_competitors = [c for c in game.competitors if is_intl(c.team_id)]
            for competitor in intl_competitors:
                for entry in competitor.roster:
                    player_id = entry.player_id
                    appearances[player_id] += 1
                    team_counts[player_id][competitor.team_id] += 1
                    jersey_counts[player_id][entry.jersey] += 1
                    if date:
                        player_dates[player_id].add(date)
                        team_player_dates[player_id][competitor.team_id].add(date)
                roster = sorted(entry.player_id for entry in competitor.roster)
                for i in range(len(roster)):
                    for j in range(i + 1, len(roster)):
                        a, b = roster[i], roster[j]
                        if a != b:
                            weights[(a, b)] += 1
                            if date:
                                edge_dates[(a, b)].add(date)

        all_dates = sorted({date for dates in player_dates.values() for date in dates})
        min_date = datetime.fromisoformat(all_dates[0]).date() if all_dates else None
        max_date = datetime.fromisoformat(all_dates[-1]).date() if all_dates else None

        edges = [
            {
                "playerA": a,
                "playerB": b,
                "weight": w,
                "dates": sorted(edge_dates[(a, b)]),
                "recency": _recency(edge_dates[(a, b)], min_date, max_date),
            }
            for (a, b), w in weights.items()
        ]
        player_teams = {}
        for pid, counts in team_counts.items():
            dates_by_team = team_player_dates.get(pid, {})
            teams = list(counts.keys())
            teams.sort(key=lambda tid: max(dates_by_team.get(tid, [""])), reverse=True)
            player_teams[pid] = teams
        player_jersey = {
            pid: self._mode(counts) for pid, counts in jersey_counts.items()
        }

        games = []
        for game in self._dataset.games:
            date = (game.date or "")[:10]
            if not date:
                continue

            venue = None
            if game.venue_id:
                v = self._dataset.venues.get(game.venue_id)
                if isinstance(v, dict):
                    venue = {
                        "name": v.get("name"),
                        "city": v.get("city"),
                        "country": v.get("country"),
                    }
            league = None
            if game.league_id:
                lg = self._dataset.leagues.get(game.league_id)
                if isinstance(lg, dict):
                    league = {
                        "name": lg.get("name"),
                        "abbreviation": lg.get("abbreviation"),
                    }

            competitors = [
                {
                    "teamId": comp.team_id,
                    "home": bool(comp.home),
                    "score": comp.score,
                    "roster": [
                        {"playerId": entry.player_id, "jersey": entry.jersey}
                        for entry in comp.roster
                    ],
                    "coach": self._dataset.coach_name(comp.coach_id)
                    if comp.coach_id
                    else None,
                }
                for comp in game.competitors
                if is_intl(comp.team_id)
            ]
            if len(competitors) < 2:
                continue
            games.append(
                {
                    "eventId": game.event_id,
                    "date": date,
                    "competitors": competitors,
                    "venue": venue,
                    "league": league,
                }
            )

        return {
            "type": "player-co-occurrence",
            "source": str(self._source),
            "dateMin": all_dates[0] if all_dates else None,
            "dateMax": all_dates[-1] if all_dates else None,
            "numPlayers": len(appearances),
            "numEdges": len(edges),
            "teams": {
                str(tid): _team_out(info, to_espid(tid))
                for tid, info in self._dataset.teams.items()
                if is_intl(tid)
            },
            "players": {str(k): v for k, v in self._dataset.players.items()},
            "appearances": {str(k): v for k, v in appearances.items()},
            "playerDates": {str(k): sorted(v) for k, v in player_dates.items()},
            "playerTeams": {str(k): v for k, v in player_teams.items()},
            "playerTeamDates": {
                str(pid): {str(tid): sorted(dates) for tid, dates in teams.items()}
                for pid, teams in team_player_dates.items()
            },
            "playerJersey": {str(k): v for k, v in player_jersey.items()},
            "edges": edges,
            "winRates": self._compute_win_rates(weights, edge_dates),
            "games": games,
        }

    def _compute_win_rates(
        self,
        weights: dict[tuple[str, str], int],
        edge_dates: dict[tuple[str, str], set],
    ) -> dict[str, float]:
        games_by_date: dict[str, list] = {}
        for game in self._dataset.games:
            date = (game.date or "")[:10]
            if date:
                games_by_date.setdefault(date, []).append(game)

        win_rates = {}
        for (a, b), dates in edge_dates.items():
            wins = 0
            n = 0
            for date in dates:
                games = games_by_date.get(date)
                if not games:
                    continue
                side = None
                game = None
                for g in games:
                    for competitor in g.competitors:
                        roster_ids = {e.player_id for e in competitor.roster}
                        if a in roster_ids and b in roster_ids:
                            game = g
                            side = competitor
                            break
                    if side is not None:
                        break
                if not side:
                    continue
                opp = next((c for c in game.competitors if c != side), None)
                if not opp:
                    continue
                n += 1
                if (
                    side.score is not None
                    and opp.score is not None
                    and side.score > opp.score
                ):
                    wins += 1
            if n:
                win_rates[f"{a},{b}"] = wins / n
        return win_rates

    def save(self, path: Path) -> None:
        atomic_write_text(path, json.dumps(self.build_dict(), indent=1))

    def summarize(self) -> str:
        data = self.build_dict()
        degrees: dict[str, int] = defaultdict(int)
        for edge in data["edges"]:
            degrees[edge["playerA"]] += 1
            degrees[edge["playerB"]] += 1

        lines = [
            f"players:   {data['numPlayers']}",
            f"edges:     {data['numEdges']}",
        ]
        if degrees:
            lines.append(f"max degree:  {max(degrees.values())}")
            lines.append(f"mean degree: {sum(degrees.values()) / len(degrees):.1f}")
            top = sorted(degrees.items(), key=lambda x: -x[1])[:5]
            lines.append("top by degree:")
            for pid, d in top:
                lines.append(f"  {self._name(pid)} ({pid}): {d}")
        heaviest = sorted(data["edges"], key=lambda e: -e["weight"])[:5]
        lines.append("heaviest edges:")
        for edge in heaviest:
            lines.append(
                f"  {self._name(edge['playerA'])} -- "
                f"{self._name(edge['playerB'])} ({edge['weight']} matches)"
            )
        return "\n".join(lines)

    def _name(self, player_id: str) -> str:
        return self._dataset.player_name(player_id) or str(player_id)

    @staticmethod
    def _mode(counts: Counter) -> int:
        return counts.most_common(1)[0][0]


def _recency(dates, min_date, max_date) -> float:
    if not dates or min_date is None or max_date is None:
        return 1.0
    span = (max_date - min_date).days
    if span <= 0:
        return 1.0
    latest = datetime.fromisoformat(max(dates)).date()
    return max(0.0, min(1.0, (latest - min_date).days / span))
