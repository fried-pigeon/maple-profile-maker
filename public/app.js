import { CARD_SIZE, THEMES, FONT, PORTRAIT_ZONE, drawCard, autoFrame } from "./card.js";

const $ = (id) => document.getElementById(id);
const S = CARD_SIZE;

const store = {
  get(k, d) { try { const v = localStorage.getItem("mtm:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mtm:" + k, JSON.stringify(v)); } catch {} },
};

const state = {
  data: null,
  sprite: null,
  frame: null,
  opt: {
    theme: store.get("theme", "sky"),
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

async function loadSprite() {
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
  state.sprite = await loadImage(`/api/image?${q}`);
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
  $("searchBtn").disabled = true;
  setStatus("불러오는 중…");
  try {
    const data = name === "__demo__" ? demoData() : await fetchCharacter(name);
    state.data = data;
    state.sprite = null;
    state.frame = null;
    // The card still renders (text only) if the character image can't be loaded.
    const [spriteResult] = await Promise.allSettled([loadSprite(), ensureFonts(cardText(data))]);
    fit();
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
    setStatus(e.message || String(e), true);
  } finally {
    $("searchBtn").disabled = false;
    render();
  }
}

function fit() {
  if (!state.sprite) return;
  state.frame = autoFrame(state.sprite, S * PORTRAIT_ZONE);
  $("zoom").value = state.frame.zoom;
}

// ---- controls -----------------------------------------------------------------

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("name").value.trim();
  if (name) search(name);
});

// theme swatches
for (const [key, t] of Object.entries(THEMES)) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "swatch";
  b.title = t.label;
  b.setAttribute("aria-label", `${t.label} 테마`);
  b.style.background = `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]} 60%, ${t.accent} 61%)`;
  b.addEventListener("click", () => {
    state.opt.theme = key;
    store.set("theme", key);
    syncThemeButtons();
    render();
  });
  b.dataset.theme = key;
  $("themes").append(b);
}
function syncThemeButtons() {
  for (const b of $("themes").children) b.setAttribute("aria-pressed", String(b.dataset.theme === state.opt.theme));
}

async function changePose(refit) {
  if (!state.data?.image && !state.data?.demo) return;
  try {
    await loadSprite();
    if (refit || !state.frame) fit();
  } catch (e) {
    setStatus(e.message, true);
  }
  render();
}

$("action").addEventListener("change", (e) => { state.pose.action = e.target.value; changePose(true); });
$("emotion").addEventListener("change", (e) => { state.pose.emotion = e.target.value; changePose(false); });
$("noWeapon").addEventListener("change", (e) => { state.pose.noWeapon = e.target.checked; changePose(true); });
$("flip").addEventListener("change", (e) => { state.opt.flip = e.target.checked; render(); });
$("autoFit").addEventListener("click", () => { fit(); render(); });

$("zoom").addEventListener("input", (e) => {
  if (!state.frame) return;
  state.frame.zoom = Number(e.target.value);
  render();
});

$("shape").value = state.opt.shape;
$("shape").addEventListener("change", (e) => { state.opt.shape = e.target.value; store.set("shape", e.target.value); render(); });

// drag to pan, wheel to zoom
const stage = $("stage");
let drag = null;
stage.addEventListener("pointerdown", (e) => {
  if (!state.frame) return;
  drag = { x: e.clientX, y: e.clientY, cx: state.frame.cx, cy: state.frame.cy };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add("dragging");
});
stage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const k = S / stage.getBoundingClientRect().width / state.frame.zoom;
  const dir = state.opt.flip ? -1 : 1;
  state.frame.cx = drag.cx - dir * (e.clientX - drag.x) * k;
  state.frame.cy = drag.cy - (e.clientY - drag.y) * k;
  render();
});
const endDrag = () => { drag = null; stage.classList.remove("dragging"); };
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);
stage.addEventListener("wheel", (e) => {
  if (!state.frame) return;
  e.preventDefault();
  const z = Math.min(40, Math.max(3, state.frame.zoom + (e.deltaY < 0 ? 1 : -1)));
  state.frame.zoom = z;
  $("zoom").value = z;
  render();
}, { passive: false });

// export
function exportBlob() {
  drawCard(ctx, state); // make sure the canvas is current
  return new Promise((r) => cardCanvas.toBlob(r, "image/png"));
}
const fileName = () => `maple-${state.data?.name || "card"}.png`;

$("download").addEventListener("click", async () => {
  const blob = await exportBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

if (navigator.canShare?.({ files: [new File([""], "x.png", { type: "image/png" })] })) {
  $("share").hidden = false;
  $("share").addEventListener("click", async () => {
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
  const eye = emotion === "E01" ? [px(37, 34, 6, 2, "#2a2230"), px(52, 32, 6, 7, "#2a2230")]
    : [px(37, 32, 6, 7, "#2a2230"), px(52, 32, 6, 7, "#2a2230"), px(38, 33, 2, 2, "#fff"), px(53, 33, 2, 2, "#fff")];
  void eye;
  px(44, 43, 6, emotion === "E02" ? 3 : 2, "#c0505a");
  px(33, 40, 4, 2, "#ffb0b0"); px(57, 40, 4, 2, "#ffb0b0");
  return c;
}

// ---- boot -------------------------------------------------------------------------

syncThemeButtons();
render();
const params = new URLSearchParams(location.search);
if (params.has("demo")) {
  search("__demo__");
} else if (params.get("name")) {
  $("name").value = params.get("name");
  search(params.get("name"));
}
