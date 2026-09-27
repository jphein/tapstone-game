// guard.js: the hands-only guard (spec 2026-09-25 §3.2 after #128). Pure: it takes the XR session's
// input sources (anything with a `hand` field) and says whether a gesture may be played.
//
// Why: on JP's Quest 2 hand tracking was OFF, and the first spike run was all controller selects that
// nobody noticed (scratch/vr/spike-day1.md). The contest build must be completable without a
// controller, and the Quest quietly prefers controllers when they are awake. So while any connected
// source is a controller, the table asks for them to be set down and plays nothing.
//
// No sources at all does not block: hands leave the cameras' view for a moment mid-match (the spike
// saw it), and outside an XR session there is nothing to guard.
export const PUT_DOWN = 'Set your controllers down: this table is played with your hands.';

export function handsGuard(sources) {
  const list = sources ? [...sources] : [];
  const controller = list.some((s) => !s || !s.hand);
  return controller ? { blocked: true, message: PUT_DOWN } : { blocked: false, message: null };
}
