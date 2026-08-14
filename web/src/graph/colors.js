// Colour helpers shared across the graph stack. Pure functions with no
// component state, reusable from the build pipeline, the sigma reducers and
// the Svelte components.

export const SHARED_MATCH_COLOR = "#9aa0a6";
export const NEUTRAL_NODE_COLOR = "#8a93a0";
export const FALLBACK_NODE_COLOR = "#8e8e93";
export const DIMMED_NODE_COLOR = "#39434f";
export const ACTIVE_BORDER_COLOR = "#ffffff";
export const LABEL_COLOR = "#d6dbe2";

// Turbo palette: one hue step per jersey number, 1 (front row) to 23 (bench).
const JERSEY_COLORS = [
	"#23171b",
	"#453390",
	"#4a52d4",
	"#4172f3",
	"#3491f8",
	"#29afeb",
	"#25cad4",
	"#2bdfb7",
	"#3af099",
	"#53fa7d",
	"#73fe64",
	"#96fa50",
	"#baf040",
	"#dae034",
	"#f3c92b",
	"#ffae25",
	"#ff9020",
	"#ff701a",
	"#eb5015",
	"#d0330e",
	"#b21c06",
	"#990e00",
	"#900d00",
];

export function jerseyColor(jersey) {
	if (jersey == null || jersey < 1 || jersey > JERSEY_COLORS.length) return FALLBACK_NODE_COLOR;
	return JERSEY_COLORS[jersey - 1];
}

// Primary kit colour of a team, or null when the team/colour is unknown.
export function teamColorOrNull(teams, teamId) {
	const team = teams && teams[teamId];
	return team && typeof team === "object" && team.color ? team.color : null;
}

export function teamColorOrFallback(teams, teamId) {
	return teamColorOrNull(teams, teamId) ?? FALLBACK_NODE_COLOR;
}

// Secondary brand colour (e.g. South Africa's gold), used for node borders.
export function teamSecondaryColorOrNull(teams, teamId) {
	const team = teams && teams[teamId];
	return team && typeof team === "object" && team.alternateColor ? team.alternateColor : null;
}

// The node fill for the current colour mode: team kit, a neutral grey, or the
// player's modal jersey-number hue.
export function nodeFillColor(mode, { teams, teamId, jersey }) {
	if (mode === "team") return teamColorOrFallback(teams, teamId);
	if (mode === "neutral") return NEUTRAL_NODE_COLOR;
	return jerseyColor(jersey);
}

// Interpolate an edge's recency onto the configured [alphaMin, alphaMax] band.
export function alphaOf(recency, alphaMin, alphaMax) {
	const r = recency == null ? 0.5 : Number(recency);
	const lo = Math.min(alphaMin, alphaMax);
	const hi = Math.max(alphaMin, alphaMax);
	return lo + (hi - lo) * Math.min(1, Math.max(0, r));
}

// Sigma blends edges with gl.blendFunc(ONE, ONE_MINUS_SRC_ALPHA) on a
// premultiplied-alpha canvas, but packs the color attribute as
// NON-premultiplied rgba. That makes translucent edges composite as opaque.
// Premultiply the rgb channels so the alpha slider actually fades edges into
// the background.
export function applyAlpha(hex, alpha) {
	const body = String(hex || "").replace("#", "");
	const r = parseInt(body.substr(0, 2), 16) || 0;
	const g = parseInt(body.substr(2, 2), 16) || 0;
	const b = parseInt(body.substr(4, 2), 16) || 0;
	const a = Math.max(0, Math.min(1, +alpha));
	return `rgba(${Math.round(r * a)},${Math.round(g * a)},${Math.round(b * a)},${a.toFixed(3)})`;
}

// Dark colours vanish on the dark background. Lift lightness to a minimum and
// floor the saturation so a border keeps its identity (navy stays navy) while
// staying visible — blending toward white washes deep hues out to grey.
const MIN_BORDER_LIGHTNESS = 0.5;
const MIN_BORDER_SATURATION = 0.4;

export function needsBorder(color) {
	if (!color || color === "transparent") return "transparent";
	const [r, g, b] = hexToRgb(color);
	const [h, s, l] = rgbToHsl(r, g, b);
	if (l >= MIN_BORDER_LIGHTNESS) return color;
	const [nr, ng, nb] = hslToRgb(h, Math.max(s, MIN_BORDER_SATURATION), MIN_BORDER_LIGHTNESS);
	return rgbToHex(nr, ng, nb);
}

function hexToRgb(hex) {
	const body = hex.replace("#", "");
	return [
		parseInt(body.substr(0, 2), 16) || 0,
		parseInt(body.substr(2, 2), 16) || 0,
		parseInt(body.substr(4, 2), 16) || 0,
	];
}

function rgbToHex(r, g, b) {
	return (
		"#" +
		[r, g, b]
			.map((x) => Math.round(x).toString(16).padStart(2, "0"))
			.join("")
	);
}

function rgbToHsl(r, g, b) {
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

function hueToRgb(p, q, t) {
	if (t < 0) t += 1;
	if (t > 1) t -= 1;
	if (t < 1 / 6) return p + (q - p) * 6 * t;
	if (t < 1 / 2) return q;
	if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
	return p;
}

function hslToRgb(h, s, l) {
	let r, g, b;
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

// Map a win rate in [0,1] to a colour on a red (loss) -> amber -> green (win)
// ramp.
export function winRateColor(p) {
	const stops = [
		[0.0, [196, 61, 55]],
		[0.5, [230, 180, 66]],
		[1.0, [46, 168, 95]],
	];
	p = Math.max(0, Math.min(1, p));
	for (let i = 1; i < stops.length; i++) {
		if (p <= stops[i][0]) {
			const [x0, color0] = stops[i - 1];
			const [x1, color1] = stops[i];
			const t = (p - x0) / (x1 - x0);
			const rgb = color0.map((v, k) =>
				Math.round(v + (color1[k] - v) * t).toString(16).padStart(2, "0"),
			);
			return "#" + rgb.join("");
		}
	}
	return "#2ea85f";
}