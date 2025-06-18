/* handlers/pairVolume24h.js -------------------------------------- */
import { buildPairVolumeSnapshot } from "../utils/pairVolumeSnapshot.js";
import { json }                    from "../utils/response.js";

export async function pairVolume24hHandler(request /*, env */) {
  try {
    const url    = new URL(request.url);
    const pairId = url.searchParams.get("pair");
    const tokenQ = url.searchParams.get("token") ?? "0";

    if (!pairId)
      return json({ error:'Missing "pair" query parameter' }, { status:400 });

    if (tokenQ !== "0" && tokenQ !== "1")
      return json({ error:'Invalid "token" param – must be "0" or "1"' },
                  { status:400 });

    const snapshot = await buildPairVolumeSnapshot({
      pairId,
      token: Number(tokenQ)
    });

    return json(snapshot);
  } catch (err) {
    if (err instanceof Response) return err;
    return json({ error: err.message || "Internal error" }, { status:500 });
  }
}
