// Shared helpers for calling the NEXON Open API (MapleStory) from Pages Functions.

export const API_BASE = "https://open.api.nexon.com";
export const IMAGE_PREFIX = "https://open.api.nexon.com/static/maplestory/character/look/";

const ERROR_MESSAGES = {
  OPENAPI00001: "넥슨 API 서버 오류입니다. 잠시 후 다시 시도해주세요.",
  OPENAPI00002: "API 접근 권한이 없습니다.",
  OPENAPI00003: "캐릭터를 찾을 수 없습니다.",
  OPENAPI00004: "요청 값이 올바르지 않습니다.",
  OPENAPI00005: "API 키가 올바르지 않습니다. 서버 설정을 확인해주세요.",
  OPENAPI00006: "API 키가 메이플스토리용이 아닙니다.",
  OPENAPI00007: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
  OPENAPI00009: "아직 데이터가 준비되지 않았습니다.",
  OPENAPI00010: "게임 점검 중입니다.",
  OPENAPI00011: "API 점검 중입니다.",
};

export class NexonError extends Error {
  constructor(code, status, message) {
    super(message || ERROR_MESSAGES[code] || "알 수 없는 오류가 발생했습니다.");
    this.code = code;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function nexonGet(env, path, params = {}, { retries = 2 } = {}) {
  if (!env.NEXON_API_KEY) {
    throw new NexonError("NO_KEY", 500, "서버에 NEXON_API_KEY가 설정되지 않았습니다.");
  }
  const url = new URL(path, API_BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "x-nxopen-api-key": env.NEXON_API_KEY, accept: "application/json" },
    });
    if (res.ok) return res.json();

    let code = "HTTP_" + res.status;
    try {
      const body = await res.json();
      if (body?.error?.name) code = body.error.name;
    } catch {}
    // Development keys allow only 5 req/s; back off and retry on rate limit / transient errors.
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new NexonError(code, res.status >= 500 ? 502 : res.status);
  }
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function errorResponse(err) {
  if (err instanceof NexonError) {
    const status = err.code === "OPENAPI00003" ? 404 : err.status || 500;
    return json({ error: { code: err.code, message: err.message } }, status, { "cache-control": "no-store" });
  }
  console.error(err);
  return json({ error: { code: "INTERNAL", message: "서버 내부 오류가 발생했습니다." } }, 500, {
    "cache-control": "no-store",
  });
}

// Wrap a handler with the Workers edge cache (caches.default) to save API quota.
export async function withEdgeCache(context, ttlSeconds, handler) {
  const { request } = context;
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(new URL(request.url).toString(), { method: "GET" });
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return hit;
  }
  const res = await handler();
  if (cache && res.status === 200) {
    const toCache = new Response(res.clone().body, res);
    toCache.headers.set("cache-control", `public, max-age=${ttlSeconds}`);
    context.waitUntil(cache.put(cacheKey, toCache));
  }
  return res;
}
