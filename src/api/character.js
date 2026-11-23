// GET /api/character?name=<캐릭터명>
// Looks up the ocid, then fetches basic info + stat (전투력) + union + popularity.
import { nexonGet, json, errorResponse, withEdgeCache, NexonError } from "../nexon.js";

const LIBERATION = {
  "0": null,
  "1": { tier: 1, key: "genesis", label: "제네시스 해방" },
  "2": { tier: 2, key: "destiny", label: "데스티니 해방" },
  "3": { tier: 3, key: "destiny2", label: "데스티니 초월" },
};

function pickStat(stat, name) {
  const row = stat?.final_stat?.find((s) => s.stat_name === name);
  return row ? row.stat_value : null;
}

export async function handleCharacter(request, env, ctx) {
  const name = (new URL(request.url).searchParams.get("name") || "").trim();
  if (!name || name.length > 12) {
    return json({ error: { code: "BAD_NAME", message: "캐릭터 이름을 확인해주세요." } }, 400);
  }

  return withEdgeCache(request, ctx, 600, async () => {
    try {
      const { ocid } = await nexonGet(env, "/maplestory/v1/id", { character_name: name });
      if (!ocid) throw new NexonError("OPENAPI00003", 404);

      // basic is required; the rest are best-effort extras.
      const optional = (p) => p.catch(() => null);
      const [basic, stat, union, popularity] = await Promise.all([
        nexonGet(env, "/maplestory/v1/character/basic", { ocid }),
        optional(nexonGet(env, "/maplestory/v1/character/stat", { ocid })),
        optional(nexonGet(env, "/maplestory/v1/user/union", { ocid })),
        optional(nexonGet(env, "/maplestory/v1/character/popularity", { ocid })),
      ]);

      const imageUrl = String(basic.character_image || "").split("?")[0];

      return json({
        name: basic.character_name,
        world: basic.world_name,
        gender: basic.character_gender,
        job: basic.character_class,
        jobLevel: basic.character_class_level,
        level: basic.character_level,
        expRate: basic.character_exp_rate,
        guild: basic.character_guild_name || null,
        created: basic.character_date_create,
        liberation: LIBERATION[String(basic.liberation_quest_clear ?? "0")] ?? null,
        combatPower: pickStat(stat, "전투력"),
        unionLevel: union?.union_level ?? null,
        unionGrade: union?.union_grade ?? null,
        popularity: popularity?.popularity ?? null,
        image: imageUrl,
        date: basic.date,
      });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
