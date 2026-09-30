// entry.js: the page's two entry buttons (logic/entry.js plans them). The browser's own offer (IWSDK's
// offer flow) is the primary mode; these buttons are both modes, primary first, and each asks IWSDK
// for its session with world.launchXR({ sessionMode }). They are plain page buttons, so a pinch or a
// poke presses them, seated or standing; the panel hides while a session runs and returns after.
export function entryPanel(world, plan, doc = globalThis.document) {
  const nav = doc?.getElementById('entry');
  if (!nav) return;
  if (!plan.entries.length) {
    const p = doc.createElement('p');
    p.textContent = 'This browser has no immersive mode. Open the page in the Meta Quest Browser.';
    nav.replaceChildren(p);
    return;
  }
  nav.replaceChildren(...plan.entries.map((e) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.mode = e.mode;
    if (e.primary) b.className = 'primary';
    const name = doc.createElement('strong');
    name.textContent = e.label;
    const hint = doc.createElement('span');
    hint.textContent = e.hint;
    b.append(name, hint);
    b.addEventListener('click', () => world.launchXR({ sessionMode: e.mode }));
    return b;
  }));
  const xr = world.renderer?.xr;
  xr?.addEventListener('sessionstart', () => (nav.hidden = true));
  xr?.addEventListener('sessionend', () => (nav.hidden = false));
}
