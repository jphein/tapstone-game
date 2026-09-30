// cpu.mjs: CPU time of a process tree from /proc, for Chromium's CPU% during a capture. Chromium is
// a child of the capture's Node process (Playwright spawns it), so the tree under process.pid is it.
import { readdirSync, readFileSync } from 'node:fs';

// { pid, ppid, ticks: utime + stime } from a /proc/<pid>/stat line. The command name sits in
// parentheses and may itself hold spaces and parentheses, so fields count from the LAST ')'.
export function parseStat(line) {
  const close = line.lastIndexOf(')');
  const f = line.slice(close + 2).split(' '); // f[0] is field 3 (state)
  return { pid: Number(line.slice(0, line.indexOf(' '))), ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]) };
}

// CPU% (100 = one core) between two tree samples `seconds` apart, at `hz` ticks per second.
export const cpuPercent = (a, b, seconds, hz = 100) => ((b.ticks - a.ticks) / hz / seconds) * 100;

// Summed ticks of every descendant of `root` (not root itself), and how many processes that was.
export function treeTicks(root = process.pid) {
  const all = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      all.push(parseStat(readFileSync(`/proc/${d}/stat`, 'utf8')));
    } catch {
      /* exited meanwhile */
    }
  }
  const kids = new Map();
  for (const p of all) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p]);
  let ticks = 0, procs = 0;
  const walk = (pid) => (kids.get(pid) ?? []).forEach((p) => ((ticks += p.ticks), procs++, walk(p.pid)));
  walk(root);
  return { ticks, procs };
}
