import type { ILLM } from "..";

const LOCAL_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;

type RouterModel = {
  id?: string;
  aliases?: string[];
  alias?: string;
  status?: string | { value?: string };
};

function statusOf(m: RouterModel | undefined): string | undefined {
  const s = m?.status;
  return typeof s === "string" ? s : s?.value;
}

async function listModels(base: string): Promise<RouterModel[] | undefined> {
  try {
    const res = await fetch(`${base}/models`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { data?: RouterModel[] };
    return Array.isArray(body.data) ? body.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best effort: when moving from one model to another on a local llama.cpp router,
 * unload the previous one first so the next model can use the freed VRAM instead of
 * the leftovers. Does nothing for other servers, other hosts, or the same model.
 * Returns true when a model was unloaded.
 */
export async function unloadRouterModel(
  from: ILLM,
  to: ILLM,
): Promise<boolean> {
  if (!from.apiBase || (from.model === to.model && from.apiBase === to.apiBase))
    return false;
  let origin: URL;
  try {
    origin = new URL(from.apiBase);
  } catch {
    return false;
  }
  if (!LOCAL_HOST.test(origin.hostname)) return false;
  const base = origin.origin;

  const models = await listModels(base);
  if (!models) return false; // not a llama.cpp router
  // Continue's `model` is the preset alias (qwen3.5:9b) while the router lists the preset
  // name (qwen3.5-9b): match exactly, by alias, then by the name without punctuation.
  const norm = (v: string | undefined) =>
    (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const entry =
    models.find(
      (m) =>
        m.id === from.model ||
        m.alias === from.model ||
        m.aliases?.includes(from.model),
    ) ?? models.find((m) => norm(m.id) === norm(from.model));
  if (entry && statusOf(entry) !== "loaded") return false;

  try {
    const res = await fetch(`${base}/models/unload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: entry?.id ?? from.model }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
  } catch {
    return false;
  }

  // The unload finishes asynchronously: wait until the router reports it gone.
  for (let i = 0; i < 40; i++) {
    const now = await listModels(base);
    const s = statusOf(now?.find((m) => m.id === (entry?.id ?? from.model)));
    if (!now || !s || s === "unloaded") return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return true;
}
