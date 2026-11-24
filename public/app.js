import { CARD_SIZE, THEMES, FONT, PORTRAIT_ZONE, drawCard, autoFrame, resolveTheme } from "./card.js";
import { TONE_LEVELS, accentFor, customThemeId, parseCustomThemeId } from "./color.js";
import { detectInApp, externalOpenUrl } from "./inapp.js";

const $ = (id) => document.getElementById(id);
const S = CARD_SIZE;

const store = {
  get(k, d) { try { const v = localStorage.getItem("mtm:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mtm:" + k, JSON.stringify(v)); } catch {} },
};

const isThemeId = (id) => Boolean(THEMES[id] || parseCustomThemeId(id));
const savedTheme = store.get("theme", "sky");

const state = {
  data: null,
  sprite: null,
  frame: null,
  // last color picked with the hue ring (kept even while a preset is selected)
  custom: parseCustomThemeId(savedTheme) ?? store.get("custom", { hue: 200, tone: 1 }),
  opt: {
    theme: isThemeId(savedTheme) ? savedTheme : "sky",
    shape: store.get("shape", "squircle"),
    flip: false,
  },
  pose: { action: "A00", emotion: "E00", noWeapon: false },
};

const cardCanvas = $("card");
const ctx = cardCanvas.getContext("2d");

// ---- rendering --------------------------------------------------------------

let raf = 0;
function render() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    drawCard(ctx, state);
    $("zoomOut").textContent = state.frame ? `${state.frame.zoom}배` : "";
  });
}

// ---- data loading -----------------------------------------------------------

function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

async function fetchCharacter(name) {
  const res = await fetch(`/api/character?name=${encodeURIComponent(name)}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || `요청 실패 (${res.status})`);
  return body;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("캐릭터 이미지를 불러오지 못했습니다."));
    img.src = src;
  });
}

// Searches and pose changes can overlap (a slow image, a quick second search). Each one
// takes a ticket; a result whose ticket is no longer the latest is dropped, so an older
// image can never land on a newer card.
let searchSeq = 0;
let spriteSeq = 0;

async function loadSprite() {
  const seq = ++spriteSeq;
  if (!state.data) return;
  if (state.data.demo) {
    state.sprite = makeDemoSprite(state.pose);
    return;
  }
  if (!state.data.image) throw new Error("캐릭터 이미지 주소가 없습니다.");
  const q = new URLSearchParams({
    url: state.data.image,
    action: state.pose.action,
    emotion: state.pose.emotion,
    wmotion: state.pose.noWeapon ? "W04" : "W00",
  });
  const img = await loadImage(`/api/image?${q}`);
  if (seq === spriteSeq) state.sprite = img;
}

async function ensureFonts(text) {
  try {
    await Promise.all([
      document.fonts.load(`800 40px ${FONT}`, text),
      document.fonts.load(`700 40px ${FONT}`, text),
      document.fonts.load(`600 40px ${FONT}`, text),
    ]);
  } catch {}
}

function cardText(d) {
  return [d.name, d.world, d.job, d.guild, d.liberation?.label, "Lv.?0123456789억만,전투력WORLDGUILD해방단계달성✦✧"].join("");
}

async function search(name) {
  const seq = ++searchSeq;
  $("searchBtn").disabled = true;
  setStatus("불러오는 중…");
  try {
    const data = name === "__demo__" ? demoData() : await fetchCharacter(name);
    if (seq !== searchSeq) return; // a newer search started meanwhile
    state.data = data;
    state.sprite = null;
    state.frame = null;
    // The card still renders (text only) if the character image can't be loaded.
    const [spriteResult] = await Promise.allSettled([loadSprite(), ensureFonts(cardText(data))]);
    if (seq !== searchSeq) return;
    fit();
    if (pendingFrame && state.frame) {
      Object.assign(state.frame, pendingFrame);
      $("zoom").value = state.frame.zoom;
    }
    pendingFrame = null;
    const summary = [data.name, data.world, data.level != null ? `Lv.${data.level}` : null, data.job]
      .filter(Boolean).join(" · ") + (data.demo ? " (데모)" : "");
    if (spriteResult.status === "rejected") {
      setStatus(`${summary} — ${spriteResult.reason?.message || "캐릭터 이미지를 불러오지 못했습니다."}`, true);
    } else {
      setStatus(summary);
    }
    $("download").disabled = false;
    $("share").disabled = false;
    if (!data.demo) {
      const u = new URL(location.href);
      u.searchParams.set("name", data.name);
      history.replaceState(null, "", u);
    }
  } catch (e) {
    if (seq === searchSeq) setStatus(e.message || String(e), true);
  } finally {
    if (seq === searchSeq) $("searchBtn").disabled = false;
    render();
  }
}

function fit() {
  if (!state.sprite) return;
  state.frame = autoFrame(state.sprite, S * PORTRAIT_ZONE);
  $("zoom").value = state.frame.zoom;
}

// ---- card settings in the URL ---------------------------------------------------
// Used to reopen the exact same card in another browser (e.g. leaving KakaoTalk's in-app
// browser, which can't save images). localStorage doesn't carry over between browsers.
let pendingFrame = null;

function stateUrl() {
  const u = new URL(location.origin + location.pathname);
  if (state.data?.name && !state.data.demo) u.searchParams.set("name", state.data.name);
  u.searchParams.set("t", state.opt.theme);
  u.searchParams.set("s", state.opt.shape);
  u.searchParams.set("a", state.pose.action);
  u.searchParams.set("e", state.pose.emotion);
  if (state.pose.noWeapon) u.searchParams.set("nw", "1");
  if (state.opt.flip) u.searchParams.set("f", "1");
  if (state.frame) {
    u.searchParams.set("z", String(state.frame.zoom));
    u.searchParams.set("x", state.frame.cx.toFixed(1));
    u.searchParams.set("y", state.frame.cy.toFixed(1));
  }
  return u.toString();
}

function applyUrlState(p) {
  if (isThemeId(p.get("t"))) {
    state.opt.theme = p.get("t");
    const c = parseCustomThemeId(state.opt.theme);
    if (c) state.custom = c;
  }
  if (["squircle", "circle"].includes(p.get("s"))) state.opt.shape = p.get("s");
  const pick = (sel, v) => (v && [...sel.options].some((o) => o.value === v) ? v : null);
  state.pose.action = pick($("action"), p.get("a")) ?? state.pose.action;
  state.pose.emotion = pick($("emotion"), p.get("e")) ?? state.pose.emotion;
  state.pose.noWeapon = p.get("nw") === "1";
  state.opt.flip = p.get("f") === "1";
  const z = Number(p.get("z")), x = Number(p.get("x")), y = Number(p.get("y"));
  if (z >= 3 && z <= 40 && Number.isFinite(x) && Number.isFinite(y) && p.has("x") && p.has("y")) {
    pendingFrame = { zoom: Math.round(z), cx: x, cy: y };
  }
  // reflect in the controls
  $("action").value = state.pose.action;
  $("emotion").value = state.pose.emotion;
  $("noWeapon").checked = state.pose.noWeapon;
  $("flip").checked = state.opt.flip;
  $("shape").value = state.opt.shape;
}

// ---- in-app browsers (KakaoTalk etc.) -----------------------------------------------
// ?inapp_test=kakao|line|other simulates an in-app browser (for testing on a PC).
const inApp = ["kakao", "line", "other"].includes(new URLSearchParams(location.search).get("inapp_test"))
  ? new URLSearchParams(location.search).get("inapp_test")
  : detectInApp();
function openInDefaultBrowser() {
  const target = externalOpenUrl(inApp, stateUrl());
  if (target) {
    location.href = target;
  } else {
    // No scheme for this app: ask the user to use the app's own "open in browser" menu.
    $("inappHow").textContent = "오른쪽 위(또는 아래) 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요.";
    $("inapp").classList.remove("flash");
    void $("inapp").offsetWidth;
    $("inapp").classList.add("flash");
    $("inapp").scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
if (inApp) {
  $("inapp").hidden = false;
  if (!externalOpenUrl(inApp, location.href)) {
    $("openExternal").hidden = true;
    $("inappHow").textContent = "오른쪽 위(또는 아래) 메뉴에서 '다른 브라우저로 열기'를 눌러 주세요.";
  }
  $("openExternal").addEventListener("click", openInDefaultBrowser);
}

// ---- controls -----------------------------------------------------------------

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  if (name) search(name);
});

// ---- themes: preset swatches + "직접 고르기" (hue ring + 3 tone levels) ------------
function setTheme(id) {
  state.opt.theme = id;
  store.set("theme", id);
  const c = parseCustomThemeId(id);
  if (c) {
    state.custom = c;
    store.set("custom", c);
  }
  syncThemeButtons();
  render();
}

for (const [key, t] of Object.entries(THEMES)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.title = t.label;
  b.setAttribute("aria-label", `${t.label} 테마`);
  b.style.background = `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]} 60%, ${t.accent} 61%)`;
  b.addEventListener("click", () => setTheme(key));
  b.dataset.theme = key;
  $("themes").append(b);
}
const customSwatch = document.createElement("button");
customSwatch.type = "button";
customSwatch.className = "swatch swatch-custom";
customSwatch.title = "직접 고르기";
customSwatch.setAttribute("aria-label", "색 직접 고르기");
customSwatch.addEventListener("click", () => setTheme(customThemeId(state.custom.hue, state.custom.tone)));
$("themes").append(customSwatch);

// ring colors per tone (the accent each hue would get), computed once
const ringColors = TONE_LEVELS.map((_, tone) => Array.from({ length: 360 }, (_, h) => accentFor(h, tone)));
const conic = (tone) => `conic-gradient(${ringColors[tone].filter((_, h) => h % 30 === 0).concat(ringColors[tone][0]).join(", ")})`;

function syncThemeButtons() {
  const custom = parseCustomThemeId(state.opt.theme);
  for (const b of $("themes").querySelectorAll("[data-theme]")) {
    b.setAttribute("aria-pressed", String(b.dataset.theme === state.opt.theme));
  }
  customSwatch.setAttribute("aria-pressed", String(Boolean(custom)));
  const acc = accentFor(state.custom.hue, state.custom.tone);
  customSwatch.style.background = `radial-gradient(circle, ${acc} 0 34%, #fff 35% 42%, transparent 43%), ${conic(state.custom.tone)}`;
  $("customColor").hidden = !custom;
  for (const b of document.querySelectorAll(".tones button")) {
    b.setAttribute("aria-checked", String(Number(b.dataset.tone) === state.custom.tone));
  }
  drawRing();
}

// hue ring: hue 0 at the top, increasing clockwise
const ring = $("hueRing");
const ringCtx = ring.getContext("2d");
function drawRing() {
  if ($("customColor").hidden) return;
  const W = ring.width, C = W / 2, R = C - 6, r = R - 46;
  const { hue, tone } = state.custom;
  const t = resolveTheme(customThemeId(hue, tone));
  ringCtx.clearRect(0, 0, W, W);
  for (let h = 0; h < 360; h++) {
    const a0 = ((h - 90.6) * Math.PI) / 180, a1 = ((h - 89.4 + 0.2) * Math.PI) / 180;
    ringCtx.beginPath();
    ringCtx.arc(C, C, R, a0, a1);
    ringCtx.arc(C, C, r, a1, a0, true);
    ringCtx.closePath();
    ringCtx.fillStyle = ringColors[tone][h];
    ringCtx.fill();
  }
  // center: the card background + accent this color produces
  const g = ringCtx.createLinearGradient(C - r, C - r, C + r, C + r);
  g.addColorStop(0, t.bg[0]);
  g.addColorStop(1, t.bg[1]);
  ringCtx.beginPath();
  ringCtx.arc(C, C, r - 14, 0, Math.PI * 2);
  ringCtx.fillStyle = g;
  ringCtx.fill();
  ringCtx.beginPath();
  ringCtx.arc(C, C, 34, 0, Math.PI * 2);
  ringCtx.fillStyle = t.accent;
  ringCtx.fill();
  // knob
  const a = ((hue - 90) * Math.PI) / 180, kr = (R + r) / 2;
  const kx = C + kr * Math.cos(a), ky = C + kr * Math.sin(a);
  ringCtx.save();
  ringCtx.shadowColor = "rgba(0,0,0,0.3)";
  ringCtx.shadowBlur = 8;
  ringCtx.beginPath();
  ringCtx.arc(kx, ky, 26, 0, Math.PI * 2);
  ringCtx.fillStyle = "#fff";
  ringCtx.fill();
  ringCtx.restore();
  ringCtx.beginPath();
  ringCtx.arc(kx, ky, 19, 0, Math.PI * 2);
  ringCtx.fillStyle = ringColors[tone][hue];
  ringCtx.fill();
  ring.setAttribute("aria-valuenow", String(hue));
  ring.setAttribute("aria-valuetext", `색조 ${hue}도, ${TONE_LEVELS[tone].label}`);
}

const setCustom = (hue, tone = state.custom.tone) =>
  setTheme(customThemeId(Math.round(((hue % 360) + 360) % 360), tone));

function hueFromPointer(e) {
  const rect = ring.getBoundingClientRect();
  const x = e.clientX - rect.left - rect.width / 2;
  const y = e.clientY - rect.top - rect.height / 2;
  return (Math.atan2(y, x) * 180) / Math.PI + 90;
}
let ringDrag = false;
ring.addEventListener("pointerdown", (e) => {
  ringDrag = true;
  ring.setPointerCapture(e.pointerId);
  setCustom(hueFromPointer(e));
});
ring.addEventListener("pointermove", (e) => { if (ringDrag) setCustom(hueFromPointer(e)); });
ring.addEventListener("pointerup", () => { ringDrag = false; });
ring.addEventListener("pointercancel", () => { ringDrag = false; });
ring.addEventListener("keydown", (e) => {
  const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 }[e.key];
  if (step === undefined) return;
  e.preventDefault();
  setCustom(state.custom.hue + step);
});
for (const b of document.querySelectorAll(".tones button")) {
  b.addEventListener("click", () => setCustom(state.custom.hue, Number(b.dataset.tone)));
}

async function changePose(refit) {
  if (!state.data?.image && !state.data?.demo) return;
  const seq = spriteSeq + 1; // the ticket loadSprite() is about to take
  try {
    await loadSprite();
    if (seq !== spriteSeq) return; // superseded by a newer pose change or search
    if (refit || !state.frame) fit();
  } catch (e) {
    if (seq === spriteSeq) setStatus(e.message, true);
  }
  render();
}

$("action").addEventListener("change", (e) => { state.pose.action = e.target.value; changePose(true); });
$("emotion").addEventListener("change", (e) => { state.pose.emotion = e.target.value; changePose(false); });
$("noWeapon").addEventListener("change", (e) => { state.pose.noWeapon = e.target.checked; changePose(true); });
$("flip").addEventListener("change", (e) => { state.opt.flip = e.target.checked; render(); });
$("autoFit").addEventListener("click", () => { fit(); render(); });

// ---- zoom (slider, +/- buttons, mouse wheel, pinch all go through setZoom) ----------
const ZOOM_MIN = 3, ZOOM_MAX = 40;
function setZoom(z) {
  if (!state.frame) return;
  state.frame.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z)));
  $("zoom").value = state.frame.zoom;
  render();
}
$("zoom").addEventListener("input", (e) => setZoom(Number(e.target.value)));
$("zoomMinus").addEventListener("click", () => state.frame && setZoom(state.frame.zoom - 1));
$("zoomPlus").addEventListener("click", () => state.frame && setZoom(state.frame.zoom + 1));

$("shape").value = state.opt.shape;
$("shape").addEventListener("change", (e) => { state.opt.shape = e.target.value; store.set("shape", e.target.value); render(); });

// ---- moving the character -------------------------------------------------------
// Mouse/pen: drag to move, wheel to zoom.
// Touch: one finger scrolls the page as usual; two fingers move + pinch-zoom.
const stage = $("stage");
const cardPxPerCssPx = () => S / stage.getBoundingClientRect().width;
function panFrom(start, dxCss, dyCss) {
  const k = cardPxPerCssPx() / state.frame.zoom;
  const dir = state.opt.flip ? -1 : 1;
  state.frame.cx = start.cx - dir * dxCss * k;
  state.frame.cy = start.cy - dyCss * k;
}

let drag = null;
stage.addEventListener("pointerdown", (e) => {
  if (!state.frame || e.pointerType === "touch") return;
  drag = { x: e.clientX, y: e.clientY, cx: state.frame.cx, cy: state.frame.cy };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("dragging");
});
stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  panFrom(drag, e.clientX - drag.x, e.clientY - drag.y);
  render();
});
const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("wheel", (e) => {
  if (!state.frame) return;
  e.preventDefault();
  setZoom(state.frame.zoom + (e.deltaY < 0 ? 1 : -1));
}, { passive: false });

let pinch = null;
const twoFinger = (t) => ({
  x: (t[0].clientX + t[1].clientX) / 2,
  y: (t[0].clientY + t[1].clientY) / 2,
  d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1,
});
stage.addEventListener("touchstart", (e) => {
  if (!state.frame || e.touches.length !== 2) return;
  e.preventDefault(); // stop the browser's own pinch-zoom / two-finger scroll
  pinch = { ...twoFinger(e.touches), zoom: state.frame.zoom, cx: state.frame.cx, cy: state.frame.cy };
}, { passive: false });
stage.addEventListener("touchmove", (e) => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const m = twoFinger(e.touches);
  state.frame.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(pinch.zoom * (m.d / pinch.d))));
  $("zoom").value = state.frame.zoom;
  panFrom(pinch, m.x - pinch.x, m.y - pinch.y);
  render();
}, { passive: false });
const endPinch = (e) => { if (e.touches.length < 2) pinch = null; };
stage.addEventListener("touchend", endPinch);
stage.addEventListener("touchcancel", endPinch);
// iOS Safari fires its own gesture events for pinch; keep the page from zooming.
for (const type of ["gesturestart", "gesturechange"]) stage.addEventListener(type, (e) => e.preventDefault());

// export
function exportBlob() {
  drawCard(ctx, state); // make sure the canvas is current
  return new Promise((r) => cardCanvas.toBlob(r, "image/png"));
}
const fileName = () => `maple-${state.data?.name || "card"}.png`;

$("download").addEventListener("click", async () => {
  if (inApp) return openInDefaultBrowser();
  const blob = await exportBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

// On phones the share sheet is the way to put the image in the photo library
// (iOS: "이미지 저장"), which is where KakaoTalk picks profile photos from.
const canShareFiles = (() => {
  try { return !!navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] }); } catch { return false; }
})();
if (canShareFiles) {
  const shareBtn = $("share");
  shareBtn.hidden = false;
  if (matchMedia("(pointer: coarse)").matches) {
    shareBtn.textContent = "사진에 저장 · 공유";
    shareBtn.classList.add("primary");
    $("download").classList.remove("primary");
    $("download").textContent = "PNG 파일로 받기";
    shareBtn.parentElement.prepend(shareBtn);
  }
  shareBtn.addEventListener("click", async () => {
    if (inApp) return openInDefaultBrowser();
    const blob = await exportBlob();
    try {
      await navigator.share({ files: [new File([blob], fileName(), { type: "image/png" })] });
    } catch {}
  });
}

// ---- demo mode (no API key needed): ?demo -----------------------------------------

function demoData() {
  return {
    demo: true, name: "단풍요정", world: "스카니아", job: "아크메이지(불,독)", level: 287,
    guild: "메이플카페", liberation: { tier: 2, key: "destiny", label: "데스티니 해방" },
    combatPower: 123456789,
  };
}

// Tiny procedural chibi sprite (96x96) for layout testing without the API.
function makeDemoSprite({ emotion, noWeapon }) {
  const c = document.createElement("canvas");
  c.width = 96; c.height = 96;
  const g = c.getContext("2d");
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  if (!noWeapon) px(66, 34, 3, 44, "#8a5a2b"), px(63, 30, 9, 8, "#4fb3ff");
  px(37, 69, 8, 14, "#2b3550"); px(49, 69, 8, 14, "#2b3550");     // legs
  px(35, 82, 11, 4, "#3a2a20"); px(48, 82, 11, 4, "#3a2a20");     // shoes
  px(33, 51, 28, 20, "#e8eef9"); px(33, 51, 28, 4, "#7b8cff");    // body
  px(28, 53, 6, 14, "#f6d3b8"); px(60, 53, 6, 14, "#f6d3b8");     // arms
  px(29, 20, 36, 32, "#f6d3b8");                                   // face
  px(26, 12, 42, 14, "#ff9d5c"); px(26, 12, 8, 30, "#ff9d5c"); px(60, 12, 8, 30, "#ff9d5c"); // hair
  px(31, 8, 32, 6, "#ffb37f");
  if (emotion === "E01") {                                         // eyes (wink)
    px(37, 34, 6, 2, "#2a2230"); px(52, 32, 6, 7, "#2a2230");
  } else {
    px(37, 32, 6, 7, "#2a2230"); px(52, 32, 6, 7, "#2a2230"); px(38, 33, 2, 2, "#fff"); px(53, 33, 2, 2, "#fff");
  }
  px(44, 43, 6, emotion === "E02" ? 3 : 2, "#c0505a");
  px(33, 40, 4, 2, "#ffb0b0"); px(57, 40, 4, 2, "#ffb0b0");
  return c;
}

// ---- boot -------------------------------------------------------------------------

const params = new URLSearchParams(location.search);
applyUrlState(params);
syncThemeButtons();
render();
if (params.has("demo")) {
  search("__demo__");
} else if (params.get("name")) {
  $("name").value = params.get("name");
  search(params.get("name"));
}
