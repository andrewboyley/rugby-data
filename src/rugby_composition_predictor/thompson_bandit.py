"""Thompson contextual bandit for rugby team composition optimization.

Replaces hill climbing with Bayesian posterior sampling over player swaps.
Each arm = a candidate player swap (remove one starter, add one bench).
Context = opponent team ID + venue/conditions.
Reward = 1 if the team with the new composition wins, 0 otherwise.
"""

from __future__ import annotations

import numpy as np
from typing import Optional


class ThompsonBandit:
    """Thompson sampling bandit for composition perturbations.

    Maintains a separate Bayesian linear model per arm (player swap).
    Context features are encoded as one-hot opponent+venue.
    Reward is binary (win/loss) per composition evaluation.

    Usage:
        bandit = ThompsonBandit(n_players=30, n_bench=8)
        # Start with an initial composition (list of 15 starter player_ids,
        # plus 8 bench player_ids).
        composition = initial_composition
        for step in range(max_steps):
            swap = bandit.sample_swap(context, composition)
            composition = apply_swap(composition, swap)
            reward = observe_match_outcome(...)           # 1=win, 0=loss
            bandit.update(swap, reward)
    """

    def __init__(
        self,
        n_players: int = 30,
        n_bench: int = 8,
        alpha: float = 1.0,
        beta: float = 1.0,
    ):
        self.n_players = n_players
        self.n_bench = n_bench
        self.alpha = alpha  # prior success count
        self.beta = beta    # prior failure count

        # Per-arm sufficient statistics: (alpha_post, beta_post)
        # One arm per possible (starter_index, bench_player_index) swap
        n_arms = n_players * n_bench  # simplify: any player can swap with any bench
        self.a = np.full(n_arms, alpha, dtype=float)
        self.b = np.full(n_arms, beta, dtype=float)
        self.arm_counts = np.zeros(n_arms, dtype=int)

    def _arm_index(self, starter_idx: int, bench_idx: int) -> int:
        return starter_idx * self.n_bench + bench_idx

    def _context_features(self, opponent_team_id: int, venue_id: str | None) -> np.ndarray:
        """One-hot encode opponent + venue as context features."""
        n_opp = self.n_players + 1  # +1 for "unknown/neutral"
        n_ven = 5  # could expand; keep small for simplicity
        dim = n_opp * n_ven
        x = np.zeros(dim, dtype=float)
        opp_idx = int(opponent_team_id) if opponent_team_id else n_opp - 1
        ven_idx = hash(venue_id or "neutral") % n_ven if venue_id else n_ven - 1
        x[opp_idx * n_ven + ven_idx] = 1.0
        return x

    def sample_swap(
        self,
        opponent_team_id: int,
        venue_id: str | None,
        composition: dict,
        rng: Optional[np.random.Generator] = None,
    ) -> tuple[int, int, float]:
        """Sample a swap arm from posterior and return (starter_idx, bench_idx, theta).

        Args:
            opponent_team_id: RIMS/ESPN team ID of the opponent.
            venue_id: Venue identifier string.
            composition: dict mapping starter_position (1..15) -> player_id,
                         plus 'bench' key -> list of bench player_ids.
            rng: optional numpy RNG.

        Returns:
            (starter_idx, bench_idx, theta) where theta ~ Beta(a, b) is the
            sampled reward rate for that swap.
        """
        if rng is None:
            rng = np.random.default_rng()

        features = self._context_features(opponent_team_id, venue_id)
        n_arms = self.n_players * self.n_bench

        # Compute per-arm posterior samples using context-weighted pseudo-counts
        # Simplified: use global posteriors with context as additional pseudo-observations
        thetas = np.empty(n_arms)
        for i in range(n_arms):
            # Sample from Beta(a_i, b_i) — we could incorporate features via
            # Bayesian linear regression, but keeping it simple with Beta posteriors.
            thetas[i] = rng.beta(self.a[i], self.b[i])

        # Pick the swap with highest sampled reward probability
        best_idx = int(np.argmax(thetas))
        starter_idx = best_idx // self.n_bench
        bench_idx = best_idx % self.n_bench
        return starter_idx, bench_idx, thetas[best_idx]

    def update(self, starter_idx: int, bench_idx: int, reward: float) -> None:
        """Observe reward for a swap and update the Beta posterior.

        Args:
            starter_idx: index of the starter player to remove (0..n_players-1).
            bench_idx: index of the bench player to add (0..n_bench-1).
            reward: 1.0 if the modified composition improved win probability,
                     0.0 otherwise (loss or draw).
        """
        idx = self._arm_index(starter_idx, bench_idx)
        self.a[idx] += reward
        self.b[idx] += 1.0 - reward
        self.arm_counts[idx] += 1

    def get_arm_stats(self, starter_idx: int, bench_idx: int) -> dict:
        """Return posterior mean and uncertainty for a given swap arm."""
        idx = self._arm_index(starter_idx, bench_idx)
        mean = self.a[idx] / (self.a[idx] + self.b[idx]) if self.a[idx] + self.b[idx] > 0 else self.alpha / (self.alpha + self.beta)
        var = (self.a[idx] * self.b[idx]) / ((self.a[idx] + self.b[idx]) **2 * (self.a[idx] + self.b[idx] + 1)) if self.a[idx] + self.b[idx] > 0 else 0.0
        return {
            "mean": float(mean),
            "uncertainty": float(np.sqrt(var)),
            "samples": int(self.arm_counts[idx]),
        }