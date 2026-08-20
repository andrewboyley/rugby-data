"""Builds a player co-occurrence graph from a Dataset.

Nodes are players; an undirected edge connects two players when they appear
in the same team's roster in the same match. Edge weight is the number of
shared matches.

Coach nodes are also included and connected to players/coaches they share
matches with on the same team.
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
    abbreviation = info.get("abbreviation") if isinstance(info, dict) else None
    return {"name": name, "color": color, "alternateColor": alt, "abbreviation": abbreviation}


def _coach_id(coach_id: str) -> str:
    """Prefix coach IDs to avoid collision with player IDs."""
    return f"c_{coach_id}"


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
        coach_weights: dict[tuple[str, str], int] = defaultdict(int)
        edge_dates: dict[tuple[str, str], set] = defaultdict(set)
        coach_edge_dates: dict[tuple[str, str], set] = defaultdict(set)
        appearances: dict[str, int] = defaultdict(int)
        coach_appearances: dict[str, int] = defaultdict(int)
        player_dates: dict[str, set] = defaultdict(set)
        coach_dates: dict[str, set] = defaultdict(set)
        team_counts: dict[str, Counter] = defaultdict(Counter)
        coach_team_counts: dict[str, Counter] = defaultdict(Counter)
        team_player_dates: dict[str, dict[int, set]] = defaultdict(
            lambda: defaultdict(set)
        )
        coach_team_dates: dict[str, dict[int, set]] = defaultdict(
            lambda: defaultdict(set)
        )
        jersey_counts: dict[str, Counter] = defaultdict(Counter)

        for game in self._dataset.games:
            date = (game.date or "")[:10]
            intl_competitors = [c for c in game.competitors if is_intl(c.team_id)]
            for competitor in intl_competitors:
                roster = sorted(entry.player_id for entry in competitor.roster)
                coach_id = competitor.coach_id
                coach_node_id = _coach_id(coach_id) if coach_id else None

                for entry in competitor.roster:
                    player_id = entry.player_id
                    appearances[player_id] += 1
                    team_counts[player_id][competitor.team_id] += 1
                    if entry.jersey is not None:
                        jersey_counts[player_id][entry.jersey] += 1
                    if date:
                        player_dates[player_id].add(date)
                        team_player_dates[player_id][competitor.team_id].add(date)

                # Coach appearances and team tracking
                if coach_node_id:
                    coach_appearances[coach_node_id] += 1
                    coach_team_counts[coach_node_id][competitor.team_id] += 1
                    if date:
                        coach_dates[coach_node_id].add(date)
                        coach_team_dates[coach_node_id][competitor.team_id].add(date)

                # Player-Player edges (same team)
                roster = sorted(entry.player_id for entry in competitor.roster)
                for i in range(len(roster)):
                    for j in range(i + 1, len(roster)):
                        a, b = roster[i], roster[j]
                        if a != b:
                            weights[(a, b)] += 1
                            if date:
                                edge_dates[(a, b)].add(date)

                # Coach-Player edges (same team)
                if coach_node_id:
                    for player_id in roster:
                        pair = tuple(sorted((coach_node_id, player_id)))
                        coach_weights[pair] += 1
                        if date:
                            coach_edge_dates[pair].add(date)

                # Coach-Coach edges (if multiple coaches on same team - rare but possible)
                # Handled implicitly by the same logic if multiple coaches per team
                # For now, assuming one coach per team per match

        all_dates = sorted({date for dates in player_dates.values() for date in dates})
        min_date = datetime.fromisoformat(all_dates[0]).date() if all_dates else None
        max_date = datetime.fromisoformat(all_dates[-1]).date() if all_dates else None

        # Player-Player edges
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

        # Coach-Player and Coach-Coach edges
        coach_edges = [
            {
                "coachA": a,
                "coachB": b,
                "weight": w,
                "dates": sorted(coach_edge_dates[(a, b)]),
                "recency": _recency(coach_edge_dates[(a, b)], min_date, max_date),
            }
            for (a, b), w in coach_weights.items()
        ]

        all_dates = sorted(
            {date for dates in list(player_dates.values()) + list(coach_dates.values()) for date in dates}
        )
        min_date = datetime.fromisoformat(all_dates[0]).date() if all_dates else None
        max_date = datetime.fromisoformat(all_dates[-1]).date() if all_dates else None

        # Player-Player edges (recompute recency with combined date range)
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

        coach_edges = [
            {
                "coachA": a,
                "coachB": b,
                "weight": w,
                "dates": sorted(coach_edge_dates[(a, b)]),
                "recency": _recency(coach_edge_dates[(a, b)], min_date, max_date),
            }
            for (a, b), w in coach_weights.items()
        ]

        player_teams = {}
        for pid, counts in team_counts.items():
            dates_by_team = team_player_dates.get(pid, {})
            teams = list(counts.keys())
            teams.sort(key=lambda tid: max(dates_by_team.get(tid, [""])), reverse=True)
            player_teams[pid] = teams

        coach_teams = {}
        for cid, counts in coach_team_counts.items():
            dates_by_team = coach_team_dates.get(cid, {})
            teams = list(counts.keys())
            teams.sort(key=lambda tid: max(dates_by_team.get(tid, [""])), reverse=True)
            coach_teams[cid] = teams

        player_jersey = {
            pid: self._mode(counts) for pid, counts in jersey_counts.items()
        }

        all_dates = sorted(
            {date for dates in list(player_dates.values()) + list(coach_dates.values()) for date in dates}
        )
        min_date = datetime.fromisoformat(all_dates[0]).date() if all_dates else None
        max_date = datetime.fromisoformat(all_dates[-1]).date() if all_dates else None

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
                    "coachId": comp.coach_id,
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
            "coachAppearances": {str(k): v for k, v in coach_appearances.items()},
            "coachDates": {str(k): sorted(v) for k, v in coach_dates.items()},
            "coachTeams": {str(k): v for k, v in coach_teams.items()},
            "coachEdges": coach_edges,
            "coaches": {str(k): v for k, v in self._dataset.coaches.items()},
            "winRates": self._compute_win_rates(
                {**edge_dates, **coach_edge_dates}
            ),
            "games": games,
        }

    def _compute_win_rates(
        self,
        pair_dates: dict[tuple[str, str], set],
    ) -> dict[str, float]:
        """Win rate per person pair (player-player, coach-player, coach-coach).

        A pair counts as a "win" when both people were on the same side of a
        match (coaches via their team's coach id) and that side won.
        """
        games_by_date: dict[str, list] = {}
        for game in self._dataset.games:
            date = (game.date or "")[:10]
            if date:
                games_by_date.setdefault(date, []).append(game)

        def on_side(person: str, competitor) -> bool:
            if person.startswith("c_"):
                return competitor.coach_id == person[2:]
            return person in {e.player_id for e in competitor.roster}

        win_rates = {}
        for (a, b), dates in pair_dates.items():
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
                        if on_side(a, competitor) and on_side(b, competitor):
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

        coach_degrees: dict[str, int] = defaultdict(int)
        for edge in data.get("coachEdges", []):
            coach_degrees[edge["coachA"]] += 1
            coach_degrees[edge["coachB"]] += 1

        lines = [
            f"players:   {data['numPlayers']}",
            f"edges:     {data['numEdges']}",
            f"coaches:   {len(data.get('coaches', {}))}",
            f"coachEdges: {len(data.get('coachEdges', []))}",
        ]
        if degrees:
            lines.append(f"max degree:  {max(degrees.values())}")
            lines.append(f"mean degree: {sum(degrees.values()) / len(degrees):.1f}")
            top = sorted(degrees.items(), key=lambda x: -x[1])[:5]
            lines.append("top by degree:")
            for pid, d in top:
                lines.append(f"  {self._name(pid)} ({pid}): {d}")
        if coach_degrees:
            lines.append(f"max coach degree:  {max(coach_degrees.values())}")
            lines.append(f"mean coach degree: {sum(coach_degrees.values()) / len(coach_degrees):.1f}")
            top = sorted(coach_degrees.items(), key=lambda x: -x[1])[:5]
            lines.append("top coaches by degree:")
            for cid, d in top:
                lines.append(f"  {self._dataset.coach_name(cid[2:]) or cid} ({cid}): {d}")
        heaviest = sorted(data["edges"], key=lambda e: -e["weight"])[:5]
        lines.append("heaviest edges:")
        for edge in heaviest:
            lines.append(
                f"  {self._name(edge['playerA'])} -- "
                f"{self._name(edge['playerB'])} ({edge['weight']} matches)"
            )
        heaviest_coach = sorted(data.get("coachEdges", []), key=lambda e: -e["weight"])[:5]
        if heaviest_coach:
            lines.append("heaviest coach edges:")
            for edge in heaviest_coach:
                lines.append(
                    f"  {edge['coachA']} -- "
                    f"{edge['coachB']} ({edge['weight']} matches)"
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