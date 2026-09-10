import type { DatasetLike, Match } from "./types";
import { isInternationalTeam } from "./internationalTeams";

export class MatchTimeline {
  readonly matches: readonly Match[];
  readonly dates: readonly number[];
  readonly dateMin: number | null;
  readonly dateMax: number | null;

  private constructor(matches: Match[]) {
    this.matches = Object.freeze(matches.map((match) => Object.freeze(match)));
    this.dates = Object.freeze([...new Set(matches.map((match) => match.timestamp))]);
    this.dateMin = this.dates[0] ?? null;
    this.dateMax = this.dates.at(-1) ?? null;
  }

  static fromDataset(dataset: DatasetLike): MatchTimeline {
    const matches: Match[] = [];
    for (const game of dataset.games ?? []) {
      const timestamp = Date.parse(game.date ?? "");
      if (!Number.isInteger(timestamp)) continue;
      // Timeline transitions are calendar days, so fixtures on the same day
      // always cross the cursor together even when their kick-off times differ.
      const day = new Date(timestamp);
      const dayTimestamp = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      const competitors = game.competitors ?? [];
      for (const competitor of competitors) {
        if (!isInternationalTeam(competitor.teamId)) continue;
        const players = [...new Set((competitor.roster ?? []).map((entry) => String(entry.playerId)))].sort();
        const coachId = competitor.coachId == null ? null : `c_${competitor.coachId}`;
        if (coachId) players.push(coachId);
        const opponent = competitors.find((candidate) => candidate !== competitor);
        const won = competitor.score == null || opponent?.score == null ? null : competitor.score === opponent.score ? null : competitor.score > opponent.score;
        if (players.length) matches.push({ eventId: game.eventId, timestamp: dayTimestamp, teamId: competitor.teamId, coachId, won, players: players.sort() });
      }
    }
    matches.sort((a, b) => a.timestamp - b.timestamp || a.eventId - b.eventId || a.teamId - b.teamId);
    return new MatchTimeline(matches);
  }
}
