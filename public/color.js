// Custom theme colors from a single hue.
//
// Colors are built in OKLCH (perceptual lightness / chroma / hue) so every hue gets the same
// visual brightness: yellow doesn't turn muddy and blue doesn't turn too dark. Lightness is
// fixed per role (the card background must stay light); the user only picks the hue and one
// of three tone levels, which scales chroma. The accent (white "Lv." text sits on it) is
// darkened per hue until white text keeps enough contrast.

// tone levels: 0 연하게, 1 기본, 2 선명하게
export const TONE_LEVELS = [
  { label: "연하게", bg: 0.55, accent: 0.75 },
  { label: "기본", bg: 1, accent: 1 },
  { label: "선명하게", bg: 1.7, accent: 1.25 },
];

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** OKLCH -> linear sRGB (may be out of [0,1]). */
function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH -> "#rrggbb", reducing chroma until the color fits in sRGB. */
export function oklch(L, C, h) {
  let rgb = oklchToLinearRgb(L, C, h);
  if (!inGamut(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinearRgb(L, mid, h))) lo = mid; else hi = mid;
    }
    rgb = oklchToLinearRgb(L, lo, h);
  }
  return "#" + rgb.map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255).toString(16).padStart(2, "0")).join("");
}

/** WCAG relative luminance of "#rrggbb". */
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const MIN_ACCENT_CONTRAST = 3.8; // white text on the accent pill (large bold text needs 3:1)

/** Accent color for a hue/tone: as light as possible while white text stays readable. */
export function accentFor(hue, tone = 1) {
  const k = TONE_LEVELS[tone]?.accent ?? 1;
  for (let L = 0.64; L > 0.3; L -= 0.01) {
    const c = oklch(L, 0.15 * k, hue);
    if (contrast(c, "#ffffff") >= MIN_ACCENT_CONTRAST) return c;
  }
  return oklch(0.3, 0.15 * k, hue);
}

/** Full card theme (same shape as the presets in card.js) for a hue (0-359) and tone (0-2). */
export function makeCustomTheme(hue, tone = 1) {
  const k = TONE_LEVELS[tone]?.bg ?? 1;
  return {
    label: "직접 고른 색",
    bg: [oklch(0.975, 0.014 * k, hue), oklch(0.905, 0.045 * k, hue)],
    panel: ["#ffffff", oklch(0.955, 0.022 * k, hue)],
    accent: accentFor(hue, tone),
    ink: oklch(0.27, 0.05, hue),
    sub: oklch(0.52, 0.05, hue),
  };
}

// Theme ids: a preset key ("sky") or a custom color "c<hue>.<tone>", e.g. "c205.1".
export const customThemeId = (hue, tone) => `c${Math.round(((hue % 360) + 360) % 360)}.${tone}`;
export function parseCustomThemeId(id) {
  const m = /^c(\d{1,3})\.([012])$/.exec(String(id ?? ""));
  if (!m || Number(m[1]) > 359) return null;
  return { hue: Number(m[1]), tone: Number(m[2]) };
}
