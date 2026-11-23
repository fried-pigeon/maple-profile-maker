// Worker entry. Static files in ./public are served by Workers Static Assets;
// requests that don't match a file (i.e. /api/*) reach this fetch handler.
import { handleCharacter } from "./api/character.js";
import { handleImage } from "./api/image.js";
import { json } from "./nexon.js";

const ROUTES = {
  "/api/character": handleCharacter,
  "/api/image": handleImage,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = ROUTES[pathname];
    if (handler) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return json({ error: { code: "METHOD", message: "GET만 지원합니다." } }, 405, { allow: "GET, HEAD" });
      }
      return handler(request, env, ctx);
    }
    if (pathname.startsWith("/api/")) {
      return json({ error: { code: "NOT_FOUND", message: "없는 API입니다." } }, 404);
    }
    return env.ASSETS.fetch(request);
  },
};
