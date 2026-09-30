// iwer-fan.mjs: the fan of cards goes where the player puts it (JP: "you need to be able to place your
// hand wherever is best for you"), in IWSDK's managed Chromium, with IWER's emulated right hand: pinch
// the grip at the fan's end, carry it 12 cm left, 6 cm up and 8 cm nearer, let go. Returns the fan's
// spot before and after, what localStorage holds, and the grip's world position (to check it squared
// up under the fan). Run in XR, hand mode, with a hand drawn (the lesson's own steps are fine).
//   npx @iwsdk/cli browser run tools/iwer-fan.mjs --timeout 60000
export default async function run({ page, frame }) {
  const f = frame ?? page;
  await f.waitForFunction(() => globalThis.__tapstone && __tapstone.play.world.renderer.xr.getSession(), null, { timeout: 30000 });
  return await f.evaluate(async () => {
    const R = IWER_DEVICE.remote, pl = __tapstone.play, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const w = (o) => { const v = o.position.clone(); o.getWorldPosition(v); return { x: v.x, y: v.y, z: v.z }; };
    const before = { ...pl.hand.origin };
    const g0 = w(pl.hand.grip);
    const delta = { x: -0.12, y: 0.06, z: 0.08 };
    // The delta is board-local; the root is turned toward the head, so carry it through the root.
    const target = pl.root.localToWorld(pl.hand.grip.position.clone().set(pl.hand.grip.position.x + delta.x, pl.hand.grip.position.y + delta.y, pl.hand.grip.position.z + delta.z));
    // IWER's hand position is the wrist; the pinch (between the index and thumb tips) sits a few cm off
    // it (measured: -4.8, +1.7, -3.0 cm at this pitch). Measure it now and aim the pinch, not the wrist.
    const DOWN = { pitch: -60, yaw: 0, roll: 0 };
    await R.dispatch('set_transform', { device: 'hand-right', position: { x: g0.x + 0.2, y: g0.y + 0.1, z: g0.z }, orientation: DOWN });
    await sleep(200);
    const xr = pl.world.renderer.xr, session = xr.getSession(), ref = xr.getReferenceSpace();
    const off = await new Promise((res) => session.requestAnimationFrame((t, fr) => {
      const src = [...session.inputSources].find((s) => s.handedness === 'right');
      const j = (n) => fr.getJointPose(src.hand.get(n), ref).transform.position;
      const it = j('index-finger-tip'), tt = j('thumb-tip'), wp = IWER_DEVICE.hands.right.position.vec3;
      res({ x: (it.x + tt.x) / 2 - wp[0], y: (it.y + tt.y) / 2 - wp[1], z: (it.z + tt.z) / 2 - wp[2] });
    }));
    const go = (p, d) => R.dispatch('animate_to', { device: 'hand-right', position: { x: p.x - off.x, y: p.y - off.y, z: p.z - off.z }, orientation: DOWN, duration: d });
    await go({ x: g0.x, y: g0.y + 0.05, z: g0.z }, 0.4);
    await go(g0, 0.3);
    await R.dispatch('set_select_value', { device: 'hand-right', value: 1 });
    await sleep(300);
    const heldWhilePinched = pl.queries.heldGrip.entities.size;
    await go({ x: target.x, y: target.y, z: target.z }, 0.8);
    await sleep(300);
    const during = { ...pl.hand.origin };
    await R.dispatch('set_select_value', { device: 'hand-right', value: 0 });
    await sleep(400);
    await go({ x: target.x + 0.2, y: target.y + 0.15, z: target.z }, 0.4);
    await sleep(300);
    return { pinchOffset: off, before, during, after: { ...pl.hand.origin }, heldWhilePinched, stored: JSON.parse(localStorage.getItem('tapstone.hand') ?? 'null'), gripLocal: { ...pl.hand.grip.position }, gripOffset: pl.hand.GRIP, delta };
  });
}
