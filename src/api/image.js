// GET /api/image?url=<character_image URL>&action=A00&emotion=E00&wmotion=W00
// Same-origin proxy for the character look image, so the browser canvas can read
// pixels (auto bust framing) and export PNG without CORS taint.
import { IMAGE_PREFIX, json, withEdgeCache } from "../nexon.js";

const ACTION_RE = /^A(0\d|[1-3]\d|4[01])(\.\d)?$/;
const EMOTION_RE = /^E(0\d|1\d|2[0-4])(\.\d)?$/;
const WMOTION_RE = /^W0[0-4]$/;

export async function handleImage(request, _env, ctx) {
  const q = new URL(request.url).searchParams;
  const src = q.get("url") || "";
  if (!src.startsWith(IMAGE_PREFIX) || /[?#]/.test(src) || src.length > 4096) {
    return json({ error: { code: "BAD_URL", message: "잘못된 이미지 주소입니다." } }, 400);
  }

  const upstream = new URL(src);
  for (const [key, re] of [["action", ACTION_RE], ["emotion", EMOTION_RE], ["wmotion", WMOTION_RE]]) {
    const v = q.get(key);
    if (v && re.test(v)) upstream.searchParams.set(key, v);
  }

  return withEdgeCache(request, ctx, 3600, async () => {
    // The look image is public; don't send the API key (it could follow a redirect).
    const res = await fetch(upstream);
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.startsWith("image/")) {
      return json({ error: { code: "IMAGE_" + res.status, message: "캐릭터 이미지를 불러오지 못했습니다." } }, 502, {
        "cache-control": "no-store",
      });
    }
    return new Response(res.body, {
      headers: { "content-type": type, "cache-control": "public, max-age=3600" },
    });
  });
}
