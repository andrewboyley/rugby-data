"""Builds a player co-occurrence graph from a Dataset.

Nodes are players; an undirected edge connects two players when they appear
in the same team's roster in the same match. Edge weight is the number of
shared matches.
"""

import json
from collections import Counter, defaultdict
from datetime import UTC, datetime
from pathlib import Path
from xml.etree import ElementTree as ET

from .dataset import Dataset
from .storage import atomic_write_text

GEXF_NS = "http://www.gexf.net/1.2draft"
GEXF_SCHEMA = "http://www.gexf.net/1.2draft/gexf.xsd"


def _q(tag: str) -> str:
    """Qualify a bare tag name with the GEXF namespace."""
    return f"{{{GEXF_NS}}}{tag}"


NODE_ATTRIBUTES = [
    ("name", "name", "string"),
    ("team", "team", "integer"),
    ("team_name", "team_name", "string"),
    ("jersey", "jersey", "integer"),
    ("app", "appearances", "integer"),
    ("dates", "dates", "string"),
]

EDGE_ATTRIBUTES = [
    ("weight", "weight", "integer"),
    ("dates", "dates", "string"),
]


class CoOccurrenceGraph:
    def __init__(self, dataset: Dataset, source: Path):
        self._dataset = dataset
        self._source = source

    def build_dict(self) -> dict:
        """Compute the graph and return its serializable form."""
        weights: dict[tuple[int, int], int] = defaultdict(int)
        edge_dates: dict[tuple[int, int], set] = defaultdict(set)
        appearances: dict[int, int] = defaultdict(int)
        player_dates: dict[int, set] = defaultdict(set)
        team_counts: dict[int, Counter] = defaultdict(Counter)
        jersey_counts: dict[int, Counter] = defaultdict(Counter)

        for game in self._dataset.games:
            date = (game.date or "")[:10]
            for competitor in game.competitors:
                for entry in competitor.roster:
                    player_id = entry.player_id
                    appearances[player_id] += 1
                    team_counts[player_id][competitor.team_id] += 1
                    jersey_counts[player_id][entry.jersey] += 1
                    if date:
                        player_dates[player_id].add(date)
                roster = sorted(entry.player_id for entry in competitor.roster)
                for i in range(len(roster)):
                    for j in range(i + 1, len(roster)):
                        a, b = roster[i], roster[j]
                        if a != b:
                            weights[(a, b)] += 1
                            if date:
                                edge_dates[(a, b)].add(date)

        edges = [
            {
                "playerA": a,
                "playerB": b,
                "weight": w,
                "dates": sorted(edge_dates[(a, b)]),
            }
            for (a, b), w in weights.items()
        ]
        player_teams = {pid: self._mode(counts) for pid, counts in team_counts.items()}
        player_jersey = {
            pid: self._mode(counts) for pid, counts in jersey_counts.items()
        }
        all_dates = sorted({date for dates in player_dates.values() for date in dates})

        return {
            "type": "player-co-occurrence",
            "source": str(self._source),
            "numPlayers": len(appearances),
            "numEdges": len(edges),
            "players": {str(k): v for k, v in self._dataset.players.items()},
            "appearances": {str(k): v for k, v in appearances.items()},
            "playerDates": {str(k): sorted(v) for k, v in player_dates.items()},
            "playerTeams": {str(k): v for k, v in player_teams.items()},
            "playerJersey": {str(k): v for k, v in player_jersey.items()},
            "teams": {str(k): v for k, v in self._dataset.teams.items()},
            "dateMin": all_dates[0] if all_dates else None,
            "dateMax": all_dates[-1] if all_dates else None,
            "edges": edges,
        }

    def build_gexf(self) -> str:
        data = self.build_dict()
        gexf = self._build_gexf_tree(data)
        xml_bytes = ET.tostring(gexf, encoding="utf-8", xml_declaration=True)
        return xml_bytes.decode("utf-8")

    def _build_gexf_tree(self, data: dict) -> ET.Element:
        ET.register_namespace("", GEXF_NS)
        gexf = ET.Element(
            _q("gexf"),
            {
                "version": "1.2",
                "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
                "xsi:schemaLocation": f"{GEXF_NS} {GEXF_SCHEMA}",
            },
        )
        self._build_meta(gexf, data)
        graph = ET.SubElement(
            gexf,
            _q("graph"),
            {
                "mode": "static",
                "defaultedgetype": "undirected",
            },
        )
        self._build_attributes(graph)
        self._add_nodes(graph, data)
        self._add_edges(graph, data)
        return gexf

    def _build_meta(self, gexf: ET.Element, data: dict) -> None:
        meta = ET.SubElement(
            gexf,
            _q("meta"),
            {
                "lastmodifieddate": str(datetime.now(UTC).date()),
            },
        )
        ET.SubElement(meta, _q("creator")).text = "rugby-composition-predictor"
        ET.SubElement(meta, _q("description")).text = "Player co-occurrence graph"
        keywords = ET.SubElement(meta, _q("keywords"))
        keywords.text = json.dumps(
            {
                "type": data["type"],
                "source": data["source"],
                "dateMin": data["dateMin"],
                "dateMax": data["dateMax"],
                "teams": data["teams"],
                "players": data["players"],
                "appearances": data["appearances"],
                "playerDates": data["playerDates"],
                "playerTeams": data["playerTeams"],
                "playerJersey": data["playerJersey"],
            }
        )

    def _build_attributes(self, graph: ET.Element) -> None:
        node_attrs = ET.SubElement(
            graph,
            _q("attributes"),
            {
                "class": "node",
                "mode": "static",
            },
        )
        for attr_id, title, attr_type in NODE_ATTRIBUTES:
            ET.SubElement(
                node_attrs,
                _q("attribute"),
                {
                    "id": attr_id,
                    "title": title,
                    "type": attr_type,
                },
            )
        edge_attrs = ET.SubElement(
            graph,
            _q("attributes"),
            {
                "class": "edge",
                "mode": "static",
            },
        )
        for attr_id, title, attr_type in EDGE_ATTRIBUTES:
            ET.SubElement(
                edge_attrs,
                _q("attribute"),
                {
                    "id": attr_id,
                    "title": title,
                    "type": attr_type,
                },
            )

    def _add_nodes(self, graph: ET.Element, data: dict) -> None:
        nodes_elem = ET.SubElement(graph, _q("nodes"))
        for pid_str, app_val in data["appearances"].items():
            name_val = data["players"].get(pid_str, pid_str)
            team_id = data["playerTeams"].get(pid_str)
            team_name_val = (
                data["teams"].get(str(team_id)) if team_id is not None else None
            )
            jersey_val = data["playerJersey"].get(pid_str)
            dates_val = ",".join(data["playerDates"].get(pid_str, []))

            node = ET.SubElement(
                nodes_elem,
                _q("node"),
                {
                    "id": pid_str,
                    "label": str(name_val),
                },
            )
            attvalues = ET.SubElement(node, _q("attvalues"))
            self._add_attvalue(attvalues, "name", name_val)
            self._add_attvalue(attvalues, "team", team_id)
            self._add_attvalue(attvalues, "team_name", team_name_val)
            self._add_attvalue(attvalues, "jersey", jersey_val)
            self._add_attvalue(attvalues, "app", app_val)
            if dates_val:
                self._add_attvalue(attvalues, "dates", dates_val)

    def _add_edges(self, graph: ET.Element, data: dict) -> None:
        edges_elem = ET.SubElement(graph, _q("edges"))
        for idx, edge in enumerate(data["edges"]):
            w = str(edge["weight"])
            edge_elem = ET.SubElement(
                edges_elem,
                _q("edge"),
                {
                    "id": str(idx),
                    "source": str(edge["playerA"]),
                    "target": str(edge["playerB"]),
                    "weight": w,
                },
            )
            attvalues = ET.SubElement(edge_elem, _q("attvalues"))
            self._add_attvalue(attvalues, "weight", w)
            dates_str = ",".join(edge.get("dates", []))
            if dates_str:
                self._add_attvalue(attvalues, "dates", dates_str)

    @staticmethod
    def _add_attvalue(parent: ET.Element, name: str, value) -> None:
        if value is None:
            return
        ET.SubElement(parent, _q("attvalue"), {"for": name, "value": str(value)})

    def save(self, path: Path) -> None:
        atomic_write_text(path, self.build_gexf())

    def summarize(self) -> str:
        data = self.build_dict()
        degrees: dict[int, int] = defaultdict(int)
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

    def _name(self, player_id: int) -> str:
        return self._dataset.player_name(player_id) or str(player_id)

    @staticmethod
    def _mode(counts: Counter) -> int:
        return counts.most_common(1)[0][0]
