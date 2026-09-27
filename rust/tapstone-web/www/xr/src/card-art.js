// card-art.js: fetches every hand card's art during load (net.js counts anything after "loaded"),
// and decodes it once, so face() only draws a bitmap. A missing file leaves the faction colour.
import { SET1_IDS, artFile } from './logic/card-art.js';

const art = new Map();

export async function preloadCardArt(base) {
  await Promise.all(SET1_IDS.map(async (id) => {
    try {
      const r = await fetch(`${base}${artFile(id)}`);
      if (r.ok) art.set(id, await createImageBitmap(await r.blob()));
    } catch (e) {
      console.warn(`[tapstone] no art for card ${id}`, e);
    }
  }));
  console.log(`[tapstone] card art ${art.size}/${SET1_IDS.length}`);
}

export const cardArt = (id) => art.get(id);
