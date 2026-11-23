// GET /api/character?name=<캐릭터명>
// Looks up the ocid, then fetches basic info + stat (전투력).
//
// Schema drift policy: only the fields below are read, so new API fields are ignored.
// Every read value is normalized (type-coerced, unknown → null) so a renamed/removed field
// hides that item on the card instead of breaking the lookup, and unknown enum values
// get a generic fallback plus a warning in the Worker logs.
import { nexonGet, json, errorResponse, withEdgeCache, NexonError } from "../nexon.js";

// liberation_quest_clear: 0 없음, 1 제네시스 해방, 2 데스티니 1차 해방, 3 데스티니 2차 초월
const LIBERATION = {
  1: { tier: 1, key: "genesis", label: "제네시스 해방" },
  2: { tier: 2, key: "destiny", label: "데스티니 해방" },
  3: { tier: 3, key: "destiny2", label: "데스티니 초월" },
};

export function parseLiberation(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (s === "0" || s.toLowerCase() === "false") return null;
  const n = Number(s);
  if (LIBERATION[n]) return LIBERATION[n];
  // A value we don't know yet (e.g. a new tier): show a generic badge rather than nothing.
  console.warn(`[character] unknown liberation_quest_clear value: ${JSON.stringify(raw)}`);
  return { tier: Number.isInteger(n) ? n : null, key: "unknown", label: "해방" };
}

const str = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const int = (v) => {
  const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

function pickStat(stat, name) {
  const rows = Array.isArray(stat?.final_stat) ? stat.final_stat : [];
  const row = rows.find((s) => s?.stat_name === name);
  return row ? int(row.stat_value) : null;
}

export async function handleCharacter(request, env, ctx) {
  const name = (new URL(request.url).searchParams.get("name") || "").trim();
  if (!name || name.length > 12) {
    return json({ error: { code: "BAD_NAME", message: "캐릭터 이름을 확인해주세요." } }, 400);
  }

  return withEdgeCache(request, ctx, 600, async () => {
    try {
      // The id endpoint answers an unknown name with OPENAPI00004 (bad parameter), not 00003.
      const idRes = await nexonGet(env, "/maplestory/v1/id", { character_name: name }).catch((err) => {
        if (err instanceof NexonError && err.code === "OPENAPI00004") throw new NexonError("OPENAPI00003", 404);
        throw err;
      });
      const ocid = str(idRes?.ocid);
      if (!ocid) throw new NexonError("OPENAPI00003", 404);

      // basic is required; stat (전투력) is best-effort.
      const [basic, stat] = await Promise.all([
        nexonGet(env, "/maplestory/v1/character/basic", { ocid }),
        nexonGet(env, "/maplestory/v1/character/stat", { ocid }).catch((err) => {
          console.warn(`[character] stat lookup failed: ${err?.code || err}`);
          return null;
        }),
      ]);
      if (!basic || typeof basic !== "object") throw new NexonError("BAD_UPSTREAM", 502, "넥슨 API 응답 형식이 올바르지 않습니다.");

      const image = str(basic.character_image)?.split("?")[0] ?? null;
      if (!image) console.warn("[character] character_image missing");

      return json({
        name: str(basic.character_name) ?? name,
        world: str(basic.world_name),
        job: str(basic.character_class),
        level: int(basic.character_level),
        guild: str(basic.character_guild_name),
        liberation: parseLiberation(basic.liberation_quest_clear),
        combatPower: pickStat(stat, "전투력"),
        image,
      });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
