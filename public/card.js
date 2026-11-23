// Card renderer: draws a square profile card onto a canvas.
// KakaoTalk uses the whole image as the icon (corners masked off), so the bust fills the
// center, name/level pills stay inside the mask, and extra info sits in the hidden corners.

export const CARD_SIZE = 1080;

// KakaoTalk shows the WHOLE square image as the profile icon, under a superellipse mask
// that touches all four edges (measured from a real screenshot: |x|^2.5 + |y|^2.5 = r^2.5).
// Only the four corners are hidden, so corner info appears in the full-size view only.
export const KAKAO_MASK_N = 2.5;

// Size of the region the bust is framed for (portrait panel ≈ this + 3%).
export const PORTRAIT_ZONE = 0.8;

export const THEMES = {
  sky:      { label: "하늘",   bg: ["#eef7ff", "#cfe5ff"], panel: ["#ffffff", "#e4f1ff"], accent: "#3b78d8", ink: "#1b2a46", sub: "#5a6f92" },
  peach:    { label: "피치",   bg: ["#fff5ee", "#ffd8c4"], panel: ["#ffffff", "#fff0e6"], accent: "#e2704f", ink: "#3d2318", sub: "#8a5d4c" },
  mint:     { label: "민트",   bg: ["#effcf6", "#c6efdc"], panel: ["#ffffff", "#e6f9f0"], accent: "#23a073", ink: "#163a2d", sub: "#4d7a69" },
  lavender: { label: "라벤더", bg: ["#f6f2ff", "#dcd0ff"], panel: ["#ffffff", "#efe9ff"], accent: "#7656d6", ink: "#271d48", sub: "#665c8c" },
  lemon:    { label: "레몬",   bg: ["#fffdec", "#ffeeb0"], panel: ["#ffffff", "#fff8d9"], accent: "#cf9312", ink: "#3b2e0c", sub: "#85703a" },
  sakura:   { label: "벚꽃",   bg: ["#fff3f7", "#ffd3e3"], panel: ["#ffffff", "#ffeaf2"], accent: "#dc5689", ink: "#43172a", sub: "#8f5670" },
  cloud:    { label: "구름",   bg: ["#fbfbfd", "#e6e9f0"], panel: ["#ffffff", "#f3f5f9"], accent: "#4a5468", ink: "#1e2330", sub: "#6b7385" },
};

const LIBERATION_STYLE = {
  genesis:  { colors: ["#ff6a3d", "#ffb347"], text: "#ffffff", glyph: "✦" },
  destiny:  { colors: ["#6a4cff", "#c06bff"], text: "#ffffff", glyph: "✦" },
  destiny2: { colors: ["#2b2f8f", "#b04cff"], text: "#ffe9a8", glyph: "✧" },
  unknown:  { colors: ["#4a5468", "#8a93a8"], text: "#ffffff", glyph: "✦" },
};

export const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

// ---- geometry -------------------------------------------------------------

// Superellipse ("squircle") path centered at (cx, cy) with radius r; n=2 is a circle.
export function squirclePath(ctx, cx, cy, r, n = 4, steps = 160) {
  ctx.beginPath();
  const e = 2 / n;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    const x = cx + r * Math.sign(c) * Math.abs(c) ** e;
    const y = cy + r * Math.sign(s) * Math.abs(s) ** e;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- formatting -----------------------------------------------------------

export function formatKoreanNumber(value) {
  // tolerate "1,234" / " 1234 " style strings as well as numbers
  const n = Math.floor(Number(String(value ?? "").replace(/[^\d.]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  const eok = Math.floor(n / 1e8);
  const man = Math.floor((n % 1e8) / 1e4);
  if (eok > 0) return man > 0 ? `${eok}억 ${man}만` : `${eok}억`;
  if (man > 0) return `${man}만`;
  return n.toLocaleString("ko-KR");
}

function font(weight, size) {
  return `${weight} ${size}px ${FONT}`;
}

// Shrink font size until the text fits maxWidth.
function fitFont(ctx, text, weight, size, maxWidth, minSize = 18) {
  let s = size;
  ctx.font = font(weight, s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = font(weight, s);
  }
  return s;
}

// ---- sprite analysis ------------------------------------------------------

// Find a good default bust framing for a character sprite.
// Returns { zoom, cx, cy } where (cx, cy) is the sprite pixel placed at the zone center
// and zoom is output pixels per sprite pixel (snapped to an integer for crisp pixels).
export function autoFrame(sprite, zoneSize) {
  const w = sprite.width, h = sprite.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(sprite, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;
  const alpha = (x, y) => data[(y * w + x) * 4 + 3];

  // Rows with enough solid pixels count as "body" (ignores faint effect pixels).
  const SOLID = 200;
  const rowCount = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha(x, y) > SOLID) rowCount[y]++;
  const top = rowCount.findIndex((n) => n >= 2);
  if (top < 0) return { zoom: Math.round(zoneSize / 60), cx: w / 2, cy: h / 2 };
  const bottom = h - 1 - [...rowCount].reverse().findIndex((n) => n >= 2); // feet

  // A bare head is ~70-74px above the feet. Big hats, umbrellas or ears can reach 130px+,
  // which would shrink and push down the face, so clamp the reference height and anchor
  // on the feet: the face lands in the same place for everyone (tall headgear gets cropped).
  const ref = Math.min(74, Math.max(66, bottom - top + 1));
  const headTop = bottom + 1 - ref;

  // Horizontal center: median x of solid pixels in the face band (robust to weapons).
  const xs = [];
  for (let y = Math.max(0, Math.round(bottom - ref * 0.85)); y <= Math.round(bottom - ref * 0.45); y++) {
    for (let x = 0; x < w; x++) if (alpha(x, y) > SOLID) xs.push(x);
  }
  xs.sort((a, b) => a - b);
  const cx = xs.length ? xs[xs.length >> 1] + 0.5 : w / 2;

  // Show roughly the top 80% of the character (head + upper body) in ~90% of the zone.
  const zoom = Math.max(2, Math.round((zoneSize * 0.9) / (ref * 0.8)));
  // Put the top of the head ~6% below the zone's top edge.
  const cy = headTop + (0.5 - 0.06) * (zoneSize / zoom);
  return { zoom, cx, cy };
}

// ---- main draw ------------------------------------------------------------

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} p
 *   p.data    character info (see /api/character)
 *   p.sprite  HTMLImageElement | HTMLCanvasElement (character look) or null
 *   p.frame   { zoom, cx, cy }
 *   p.opt     { theme, shape, flip }
 * Fixed layout: name (top), Lv + job (bottom), world / liberation / guild / 전투력 in the corners.
 * Any missing value just leaves its slot empty.
 */
export function drawCard(ctx, { data, sprite, frame, opt }) {
  const S = CARD_SIZE;
  const t = THEMES[opt.theme] || THEMES.sky;
  const zone = S * PORTRAIT_ZONE;       // area the bust is framed for
  const P = zone + S * 0.03;            // portrait panel a bit larger than the zone
  const C = S / 2;
  const shapeN = opt.shape === "circle" ? 2 : 4;
  const band = (S - P) / 2;             // space between panel and card edge

  ctx.save();
  ctx.clearRect(0, 0, S, S);

  // Background ---------------------------------------------------------------
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, t.bg[0]);
  bg.addColorStop(1, t.bg[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);

  // soft dot pattern
  ctx.fillStyle = hexA(t.accent, 0.08);
  for (let y = 18; y < S; y += 36) {
    for (let x = 18 + ((y / 36) % 2) * 18; x < S; x += 36) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // corner glows
  for (const [gx, gy, gr] of [[0, 0, S * 0.45], [S, S, S * 0.5]]) {
    const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    rg.addColorStop(0, "rgba(255,255,255,0.75)");
    rg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, S, S);
  }

  // Portrait panel -----------------------------------------------------------
  ctx.save();
  ctx.shadowColor = hexA(t.ink, 0.18);
  ctx.shadowBlur = 36;
  ctx.shadowOffsetY = 10;
  squirclePath(ctx, C, C, P / 2 + 8, shapeN);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.restore();

  ctx.save();
  squirclePath(ctx, C, C, P / 2, shapeN);
  ctx.clip();
  const pg = ctx.createRadialGradient(C, C - P * 0.12, P * 0.05, C, C, P * 0.75);
  pg.addColorStop(0, t.panel[0]);
  pg.addColorStop(1, t.panel[1]);
  ctx.fillStyle = pg;
  ctx.fillRect(0, 0, S, S);
  // halo ring behind the head
  ctx.strokeStyle = hexA(t.accent, 0.1);
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.arc(C, C - zone * 0.06, zone * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  if (sprite && frame) {
    ctx.imageSmoothingEnabled = false;
    const { zoom, cx, cy } = frame;
    const dw = sprite.width * zoom, dh = sprite.height * zoom;
    const dx = C - cx * zoom, dy = C - cy * zoom;
    if (opt.flip) {
      ctx.translate(C * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sprite, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
  }
  ctx.restore();

  // inner border of the panel
  ctx.save();
  squirclePath(ctx, C, C, P / 2 + 4, shapeN);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.stroke();
  squirclePath(ctx, C, C, P / 2 + 10, shapeN);
  ctx.strokeStyle = hexA(t.accent, 0.35);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  if (!data) {
    ctx.restore();
    return;
  }

  // Text -------------------------------------------------------------------
  const edge = Math.max(26, S * 0.03);

  // Top center: character name on a pill that overlaps the panel edge.
  {
    const name = data.name || "";
    const size = fitFont(ctx, name, 800, Math.min(64, band * 0.62 + 14), S * 0.42, 28);
    ctx.font = font(800, size);
    const w = ctx.measureText(name).width + size * 1.1;
    const h = size * 1.45;
    const y = Math.max(edge * 0.6, band - h * 0.55);
    pill(ctx, C - w / 2, y, w, h, "#ffffff", hexA(t.ink, 0.16));
    ctx.fillStyle = t.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, C, y + h / 2 + size * 0.04);
  }

  // Bottom center: level + job.
  {
    const lv = `Lv.${data.level ?? "?"}`;
    const job = data.job || "";
    let size = Math.min(46, band * 0.48 + 10);
    const maxW = S * 0.42; // keep the pill inside the icon mask
    const measure = () => {
      ctx.font = font(800, size);
      let w = ctx.measureText(lv).width;
      if (job) {
        ctx.font = font(600, size * 0.8);
        w += size * 0.55 + ctx.measureText(job).width;
      }
      return w;
    };
    while (size > 22 && measure() > maxW) size -= 2;
    const contentW = measure();
    const w = contentW + size * 1.2;
    const h = size * 1.55;
    const y = Math.min(S - h - edge * 0.6, S - band - h * 0.45);
    pill(ctx, C - w / 2, y, w, h, t.accent, hexA(t.accent, 0.35));
    let x = C - contentW / 2;
    const mid = y + h / 2 + size * 0.04;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = font(800, size);
    ctx.fillText(lv, x, mid);
    x += ctx.measureText(lv).width;
    if (job) {
      x += size * 0.55;
      ctx.font = font(600, size * 0.8);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillText(job, x, mid);
    }
  }

  // Corners ----------------------------------------------------------------
  // Each tag is sized to sit entirely inside the corner that KakaoTalk's icon mask hides,
  // so the icon stays clean and the info shows only in the full-size profile view.
  if (data.world) cornerTag(ctx, { corner: "tl", label: "WORLD", value: String(data.world), t });
  if (data.liberation) {
    // Unknown keys (a tier added to the API later) fall back to a generic badge.
    const key = LIBERATION_TAG[data.liberation.key] ? data.liberation.key : "unknown";
    const lib = key === "unknown"
      ? { label: "✦ 해방", value: data.liberation.tier ? `${data.liberation.tier}단계` : "달성" }
      : LIBERATION_TAG[key];
    cornerTag(ctx, { corner: "tr", ...lib, t, style: LIBERATION_STYLE[key] });
  }
  if (data.guild) cornerTag(ctx, { corner: "bl", label: "GUILD", value: String(data.guild), t });
  const cp = formatKoreanNumber(data.combatPower);
  if (cp) cornerTag(ctx, { corner: "br", label: "전투력", value: cp, t });

  ctx.restore();
}

const LIBERATION_TAG = {
  genesis:  { label: "✦ 해방",     value: "제네시스" },
  destiny:  { label: "✦ 1차 해방", value: "데스티니" },
  destiny2: { label: "✧ 2차 초월", value: "데스티니" },
};

const CORNER_EDGE = 14;   // distance from the card edge
const CORNER_H = 70;      // tag height
const CORNER_SLACK = 6;   // keep this far outside the mask

// Widest box (anchored at a corner, CORNER_EDGE from both edges, height h) whose inner
// corner still lies outside the KakaoTalk icon mask.
export function maxCornerWidth(S = CARD_SIZE, h = CORNER_H, e = CORNER_EDGE) {
  const r = S / 2;
  const n = KAKAO_MASK_N;
  const v = (r - e - h - CORNER_SLACK) / r;
  const u = Math.pow(1 - Math.pow(Math.max(0, v), n), 1 / n);
  return Math.floor(r - e - r * u - CORNER_SLACK);
}

// Small two-line label block that fits inside a hidden corner.
function cornerTag(ctx, { corner, label, value, t, style }) {
  const S = CARD_SIZE;
  const h = CORNER_H;
  const maxW = maxCornerWidth(S, h);
  const padX = 16;
  const labelSize = fitFont(ctx, label, 700, 18, maxW - padX * 2, 12);
  const valueSize = fitFont(ctx, value, 800, 30, maxW - padX * 2, 14);
  ctx.font = font(800, valueSize);
  const vw = ctx.measureText(value).width;
  ctx.font = font(700, labelSize);
  const lw = ctx.measureText(label).width;
  const w = Math.min(maxW, Math.max(vw, lw) + padX * 2);
  const left = corner[1] === "l";
  const top = corner[0] === "t";
  const bx = left ? CORNER_EDGE : S - CORNER_EDGE - w;
  const by = top ? CORNER_EDGE : S - CORNER_EDGE - h;

  ctx.save();
  roundRectPath(ctx, bx, by, w, h, 18);
  ctx.shadowColor = style ? hexA(style.colors[0], 0.4) : hexA(t.ink, 0.12);
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  if (style) {
    const g = ctx.createLinearGradient(bx, by, bx + w, by + h);
    g.addColorStop(0, style.colors[0]);
    g.addColorStop(1, style.colors[1]);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
  }
  ctx.fill();
  ctx.restore();

  const tx = left ? bx + padX : bx + w - padX;
  const gap = (h - labelSize - valueSize) / 3;
  ctx.textAlign = left ? "left" : "right";
  ctx.textBaseline = "top";
  ctx.font = font(700, labelSize);
  ctx.fillStyle = style ? hexA(style.text, 0.85) : t.accent;
  ctx.fillText(label, tx, by + gap);
  ctx.font = font(800, valueSize);
  ctx.fillStyle = style ? style.text : t.ink;
  ctx.fillText(value, tx, by + gap * 2 + labelSize - 1);
}

function pill(ctx, x, y, w, h, fill, shadow) {
  ctx.save();
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
