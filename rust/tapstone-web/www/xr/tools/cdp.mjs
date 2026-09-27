// Evaluate an expression in the Tapstone page over the Chrome DevTools Protocol: IWER's managed
// Chrome (katana :9222) or the Quest Browser (adb forward to CDP_PORT). Prints the value as JSON.
//   CDP_PORT=9222 PAGE_MATCH=localhost:8081 node tools/cdp.mjs '__tapstone.stats()'
const expr = process.argv[2];
const port = process.env.CDP_PORT || 9222, match = process.env.PAGE_MATCH || 'localhost';
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = pages.find((p) => p.type === 'page' && p.url.includes(match));
if (!page) {
  console.error('no Tapstone page; pages:', pages.map((p) => p.url));
  process.exit(2);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
const reply = new Promise((r) => (ws.onmessage = (m) => r(JSON.parse(m.data))));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `JSON.stringify(${expr})`, returnByValue: true } }));
const d = await reply;
ws.close();
console.log(d.result?.result?.value ?? JSON.stringify(d.result));
