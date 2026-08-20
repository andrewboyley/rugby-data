// Colour utilities shared across the graph stack and Svelte components.
// winRateColor lives here — the canonical source, imported by build-graph
// and reducers.

import type { RawTeamInfo } from "../types.ts";

export const SHARED_MATCH_COLOR = "#9aa0a6";
export const NEUTRAL_NODE_COLOR = "#8a93a0";
export const FALLBACK_NODE_COLOR = "#8e8e93";
export const DIMMED_NODE_COLOR = "#39434f";
export const ACTIVE_BORDER_COLOR = "#ffffff";
export const LABEL_COLOR = "#d6dbe2";

// Distinct hues used to colour synthetic clusters in the test-page generator
// (graph-generator.ts). Cycled past the palette length with a deterministic
// HSL fallback when clusterCount exceeds the palette size.
export const CLUSTER_COLORS: string[] = [
  "#e03131", "#1971c2", "#40c057", "#fa923f",
  "#862e9c", "#e8590c", "#109868", "#0b7285",
  "#c2255c", "#5c940d", "#9c36b5", "#e67700",
];

const JERSEY_COLORS: string[] = [
  "#23171b", "#453390", "#4a52d4", "#4172f3", "#3491f8",
  "#29afeb", "#25cad4", "#2bdfb7", "#3af099", "#53fa7d",
  "#73fe64", "#96fa50", "#baf040", "#dae034", "#f3c92b",
  "#ffae25", "#ff9020", "#ff701a", "#eb5015", "#d0330e",
  "#b21c06", "#990e00", "#900d00",
];

export function jerseyColor(jersey: number | null | undefined): string {
  if (jersey == null || jersey < 1 || jersey > JERSEY_COLORS.length) return FALLBACK_NODE_COLOR;
  return JERSEY_COLORS[jersey - 1];
}

export function teamColorOrNull(teams: Record<number, RawTeamInfo>, teamId: number | null): string | null {
  if (teamId == null) return null;
  const team = teams[teamId];
  return team?.color ?? null;
}

export function teamColorOrFallback(teams: Record<number, RawTeamInfo>, teamId: number | null): string {
  return teamColorOrNull(teams, teamId) ?? FALLBACK_NODE_COLOR;
}

export function teamSecondaryColorOrNull(teams: Record<number, RawTeamInfo>, teamId: number | null): string | null {
  if (teamId == null) return null;
  const team = teams[teamId];
  return team?.alternateColor ?? null;
}

export function nodeFillColor(
  mode: string,
  opts: { teams: Record<number, RawTeamInfo>; teamId: number | null; jersey: number | null; isCoach?: boolean },
): string {
  // Coaches colour exactly like players so they read consistently in every
  // view; `isCoach` is accepted for API symmetry but does not change the fill.
  if (mode === "team") return teamColorOrFallback(opts.teams, opts.teamId);
  if (mode === "neutral") return NEUTRAL_NODE_COLOR;
  return jerseyColor(opts.jersey);
}

export function alphaOf(recency: number | null | undefined, alphaMin: number, alphaMax: number): number {
  const r = recency == null ? 0.5 : Number(recency);
  const lo = Math.min(alphaMin, alphaMax);
  const hi = Math.max(alphaMin, alphaMax);
  return lo + (hi - lo) * Math.min(1, Math.max(0, r));
}

export function applyAlpha(hex: string | undefined, alpha: number): string {
  const body = String(hex ?? "").replace("#", "");
  const r = parseInt(body.substring(0, 2), 16) || 0;
  const g = parseInt(body.substring(2, 4), 16) || 0;
  const b = parseInt(body.substring(4, 6), 16) || 0;
  const a = Math.max(0, Math.min(1, +alpha));
  return `rgba(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)},${a.toFixed(3)})`;
}

const MIN_BORDER_LIGHTNESS = 0.5;
const MIN_BORDER_SATURATION = 0.4;

export function needsBorder(color: string | undefined | null): string {
  if (!color || color === "transparent") return "transparent";
  const [r, g, b] = hexToRgb(color);
  const [h, s, l] = rgbToHsl(r, g, b);
  if (l >= MIN_BORDER_LIGHTNESS) return color;
  const [nr, ng, nb] = hslToRgb(h, Math.max(s, MIN_BORDER_SATURATION), MIN_BORDER_LIGHTNESS);
  return rgbToHex(nr, ng, nb);
}

export function mixHexColors(colorA: string, colorB: string, t = 0.5): string {
  const [r1, g1, b1] = hexToRgb(colorA);
  const [r2, g2, b2] = hexToRgb(colorB);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

function hexToRgb(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [
    parseInt(body.substring(0, 2), 16) || 0,
    parseInt(body.substring(2, 4), 16) || 0,
    parseInt(body.substring(4, 6), 16) || 0,
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) => Math.round(x).toString(16).padStart(2, "0"))
      .join("")
  );
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

// winRateColor imported from lib.ts — single source of truth.

// Map a win rate in [0,1] to a colour on a red (loss) -> amber -> green (win) ramp.
export function winRateColor(p: number): string {
  const stops: [number, [number, number, number]][] = [
    [0.0, [196, 61, 55]],
    [0.5, [230, 180, 66]],
    [1.0, [46, 168, 95]],
  ];
  p = Math.max(0, Math.min(1, p));
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const [x0, c0] = stops[i - 1];
      const [x1, c1] = stops[i];
      const t = (p - x0) / (x1 - x0);
      const rgb = c0.map((v, k) =>
        Math.round(v + (c1[k] - v) * t).toString(16).padStart(2, "0")
      );
      return "#" + rgb.join("");
    }
  }
  return "#2ea85f";
}
