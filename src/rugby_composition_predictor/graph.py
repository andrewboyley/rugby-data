"""Builds a player co-occurrence graph from a Dataset.

Nodes are players; an undirected edge connects two players when they appear
in the same team's roster in the same match. Edge weight is the number of
shared matches.
"""

from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Tuple

from .dataset import Dataset
from .storage import atomic_write_json


class CoOccurrenceGraph:
    def __init__(self, dataset: Dataset, source: Path):
        self._dataset = dataset
        self._source = source

    def build(self) -> Dict:
        """Compute the graph and return its serializable form."""
        weights: Dict[Tuple[int, int], int] = defaultdict(int)
        edge_dates: Dict[Tuple[int, int], set] = defaultdict(set)
        appearances: Dict[int, int] = defaultdict(int)
        player_dates: Dict[int, set] = defaultdict(set)
        team_counts: Dict[int, Counter] = defaultdict(Counter)

        for game in self._dataset.games:
            date = (game.date or "")[:10]
            for competitor in game.competitors:
                roster = sorted(
                    entry.player_id for entry in competitor.roster)
                for player_id in roster:
                    appearances[player_id] += 1
                    team_counts[player_id][competitor.team_id] += 1
                    if date:
                        player_dates[player_id].add(date)
                for i in range(len(roster)):
                    for j in range(i + 1, len(roster)):
                        a, b = roster[i], roster[j]
                        if a != b:
                            weights[(a, b)] += 1
                            if date:
                                edge_dates[(a, b)].add(date)

        edges = [{
            "playerA": a, "playerB": b, "weight": w,
            "dates": sorted(edge_dates[(a, b)]),
        } for (a, b), w in weights.items()]
        player_teams = {
            pid: counts.most_common(1)[0][0]
            for pid, counts in team_counts.items()
        }
        all_dates = sorted({date for dates in player_dates.values()
                            for date in dates})

        return {
            "type": "player-co-occurrence",
            "source": str(self._source),
            "numPlayers": len(appearances),
            "numEdges": len(edges),
            "players": {str(k): v for k, v in self._dataset.players.items()},
            "appearances": {str(k): v for k, v in appearances.items()},
            "playerDates": {str(k): sorted(v) for k, v in player_dates.items()},
            "playerTeams": {str(k): v for k, v in player_teams.items()},
            "teams": {str(k): v for k, v in self._dataset.teams.items()},
            "dateMin": all_dates[0] if all_dates else None,
            "dateMax": all_dates[-1] if all_dates else None,
            "edges": edges,
        }

    def save(self, path: Path) -> None:
        atomic_write_json(path, self.build())

    def summarize(self) -> str:
        data = self.build()
        degrees: Dict[int, int] = defaultdict(int)
        for edge in data["edges"]:
            degrees[edge["playerA"]] += 1
            degrees[edge["playerB"]] += 1

        lines = [
            f"players:   {data['numPlayers']}",
            f"edges:     {data['numEdges']}",
        ]
        if degrees:
            lines.append(f"max degree:  {max(degrees.values())}")
            lines.append(f"mean degree: "
                         f"{sum(degrees.values()) / len(degrees):.1f}")
            top = sorted(degrees.items(), key=lambda x: -x[1])[:5]
            lines.append("top by degree:")
            for pid, d in top:
                lines.append(f"  {self._name(pid)} ({pid}): {d}")
        heaviest = sorted(data["edges"], key=lambda e: -e["weight"])[:5]
        lines.append("heaviest edges:")
        for edge in heaviest:
            lines.append(
                f"  {self._name(edge['playerA'])} -- "
                f"{self._name(edge['playerB'])} ({edge['weight']} matches)")
        return "\n".join(lines)

    def _name(self, player_id: int) -> str:
        return self._dataset.player_name(player_id) or str(player_id)
