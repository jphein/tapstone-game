// The two ways in (0039: "the judged build offers both"). Pure, so node checks the plan.
//   Mixed reality ('immersive-ar'): the player's own room is the Tea House, and only the doors appear.
//   Full VR ('immersive-vr'): the lantern-lit interior around the table.
// Mixed reality is the default, because judges score "passthrough should be purposeful"; full VR is
// the second choice. A device with only one of the two gets that one, offered on its own.
//
// `offer` is the mode the browser offers natively (IWSDK's offer flow: navigator.xr.offerSession,
// the Quest Browser's own "enter" button); `entries` are the page's buttons (entry.js), primary first.
// Both are 2D page buttons before the session, so a hand's pinch or a poke reaches them, seated or not.
export const MR = 'immersive-ar';
export const VR = 'immersive-vr';

const ENTRIES = [
  { mode: MR, label: 'Mixed reality', hint: 'Your own room becomes the Tea House, with its doors around your table.' },
  { mode: VR, label: 'Full VR', hint: 'Step inside the lantern-lit Tea House.' },
];

export function entryPlan({ ar, vr }) {
  const entries = ENTRIES.filter((e) => (e.mode === MR ? ar : vr)).map((e, i) => ({ ...e, primary: i === 0 }));
  return { offer: entries[0]?.mode ?? null, entries };
}

// Which room the Tea House builds for a session: the interior only where the view is opaque (VR);
// with passthrough ('alpha-blend', or 'additive' glass) the person's room is the Tea House.
export function roomFor(session) {
  if (!session) return null;
  return session.environmentBlendMode === 'opaque' ? 'interior' : 'doors';
}

// What this browser can enter. A rejection (a permissions policy, a missing runtime) is "no".
export async function supportedModes(xr) {
  const ask = async (mode) => {
    try {
      return !!(await xr?.isSessionSupported?.(mode));
    } catch {
      return false;
    }
  };
  const [ar, vr] = await Promise.all([ask(MR), ask(VR)]);
  return { ar, vr };
}
