# Verification — what actually caught things here

Earned on 2026-09-22: four defects in one enclosure part, two in the simulator, and five blind
instruments, none of which was catchable by reading. Each rule below names the incident that
produced it, so a future reader can weigh it against their own situation rather than take it on
authority. Modelled on `~/Projects/ember.realm.watch/docs/verification.md`, which serves the same
purpose there.

- **A green check is a claim, not evidence.** Every defect found in the enclosure this week lived
  behind a passing check, and in three of four cases *the check was the defect*. Perturb it: break
  the thing deliberately and confirm the check screams. It was the cheapest verification used
  anywhere in this project.
- **Prove the check can see its own subject — build the control from the mechanism, not the
  symptom.** A check that never fires and a check that always passes are indistinguishable from
  outside. Five instances in one day: a perturbation that expanded a dirty region to the whole panel
  and screamed at nothing; a negative control that drew at a fixed point the band translation
  corrects, so it behaved identically banded or not, leaving six invariance tests behind a control
  that could not fail; a per-chip lint arm whose missing-target guard **skipped the one chip the
  issue was about** while exiting 0, caught only by planting a real lint and noticing the arm stayed
  green; an `nm` in a shell that had not sourced the toolchain, reporting zero symbols for
  everything; and a test suite grepping colourised output. None was catchable by reading. A stub
  suite only tests the logic you thought of, so make the control fail for the reason the mechanism
  could actually be wrong.
- **Build the checked thing and the checking thing from one object.** `apron()` and its checks were
  two descriptions of the same geometry, so every check was only as true as the coincidence that
  they still agreed — and when the coincidence broke, the part shipped a fix that existed only in
  the model. One source, or the class stays reviewable instead of impossible.
- **Derive constants from their constraints; never type them.** A typed number is a second opinion
  about a constraint already written down elsewhere, and the two drift silently. Each derived
  constant here caught something the typed version hid.
- **An exemption list must fail closed in both directions.** A blanket "skip pairs that intersect"
  inverts the failure mode: the worse the collision, the less the check says. Name each exemption,
  make an unexpected one an error, and make a *removed* one an error too.
- **Every win-rate number carries the name of the picker that produced it.** Two scripted seats
  differing only in whether they stop early gave opposite answers to the same balance question. Any
  simulated result is evidence about the instrument first and the rules second.
- **A budget check must assert headroom, not non-exceedance.** "Fits" and "affordable" are
  different claims, and a check written for the first passes the exact shape the rule exists to
  prevent. Splitting a lane animation into six per-row windows costs 32.4 ms of a 33.3 ms frame — it
  fits, and leaves 3% for the engine, the mesh and the touch poll, against 65% for the same pixels
  in one window. The same blind spot appeared twice in one day in different modules: a perturbation
  that expanded a dirty region to the whole panel also passed, because a full repaint still "fits".
- **A size or layout claim about a target is only evidence if the target's compiler evaluated it.**
  `Game` was measured at 350 B on an x86_64 host, then enforced by a host test — two stacked
  host-shaped measurements behind a criterion about a chip, and neither had touched it. It is now a
  `const _: () = assert!(size_of::<Game>() <= 350)` in the firmware crate, which the compiler
  targeting the chip must evaluate, proven with a control at 349 that fails. A const assert nobody
  evaluates looks identical to one that always holds, so the control is the part that carries the
  weight. Any future budget criterion should take that shape.
- **Prefer an instrument that can disagree with a picture.** Synthetic tests build the state they
  expect and agree with themselves. Two of three defects caught inside the screen work came from a
  render and a measurement of the same real engine output disagreeing.
- **A number in a document is not a measurement unless it says what measured it.** Four instances in
  one day, each quoted onward as though it were fact: a flash ceiling derived from a scratch harness
  and cited as a budget (the real figure was 9.7 KB against a claimed 8); a linked-size figure that
  was an *unlinked* measurement of different code; a cost table hand-copied into a manifest; and a
  full-frame timing that the source document itself labelled *"extrapolated … not measured"* and
  which turned out to be below the wire's physical floor. The remedy is cheap and was proven inside
  a day — a test that runs the tool and asserts the documented figures. It looked like housekeeping
  next to a check on code, and the failure it caught was **a document being quoted as if it were
  code**.

- **A restore must be newer than the build it undoes, on the machine that builds.** A perturbation
  is only evidence if the control really runs on the restored code. Two lanes hit the same trap on
  2026-09-23, independently: one restored a perturbed file with `mv` (which keeps the backup's old
  mtime), the other from a `.bak` older than the last build. In both cases cargo saw nothing newer
  than its artefact, so it re-ran the perturbed binary and the "restored" run was blind. One even ran
  the next perturbation with the previous one still compiled in. Restore with a write that bumps the
  mtime (`cp`, `sed -i`, `touch`), then run the baseline once and see it green before trusting the
  next red.

  **Editing on katana and building on familiar adds a second copy that can go stale by itself** (PR
  #110, 2026-09-25, the third time this happened, and it was the `mv` trap again, from a lane that
  hadn't read this rule first). A perturbation (`+= 1` → `+= 2`) was synced to familiar with
  `rsync -a`, then undone on katana by `mv`-ing back a `cp` backup made in the same second as the
  perturbed write. The file kept its size and its whole-second mtime, and rsync's quick check
  compares exactly those two (the default `--modify-window` 0 "matches just integer seconds",
  `man rsync` 3.4.1), so **it never sent the restore**. Adding `--checksum` sent it, but `-a`
  also carried over the backup's older mtime, which is older than familiar's perturbed artefact, so
  **cargo reused the perturbed binary** anyway. The suite reported the restored code red, with
  exactly twice the records (33594 against 16797), and that number is what gave it away. One
  perturbation meanwhile ran with the previous one still compiled in, which is the 2026-09-23
  failure repeated. The fix has two halves, because either copy can be the stale one:
  - **sync with `rsync -rlp --checksum`, never `-a` or `-t`.** Without preserved times every
    transferred file lands on the build host at the current time, newer than any artefact there,
    and `--checksum` never skips a same-size edit;
  - **run `cargo clean -p <crate>` before the final gate**, so the verdict comes from a binary built
    after every restore.

  The rule, stated from the evidence: **a perturbation is undone when the rebuilt binary is green,
  not when the source diff is empty.** Here the diff was empty on both machines, and the binary still
  held the perturbation.

  **Python's bytecode cache has the same blind spot** (#132, 2026-09-28). A perturbation swapped
  `en_US-ryan-high` for `en_GB-cori-high` in `tools/voice_pack.py`, and a `cp` restored it within the
  same second. The two names are the same length, so the file kept its size and its whole-second
  mtime, and those are the two things a `.pyc` is checked against. The restored suite stayed red with
  the perturbed name. Deleting `tools/__pycache__/voice_pack.*.pyc` turned it green. After restoring a
  Python perturbation, run the baseline with `python3 -B` or clear the cache.

- **Never share a cargo target dir between two source trees at different paths.** Any crate that
  bakes in `env!("CARGO_MANIFEST_DIR")` (this repo's `decks_dir()` does) gets a *path* compiled into
  its artefact, while cargo fingerprints by *content*. So a checkout at a new path whose content
  matches reuses the other tree's build, including the other tree's paths. Oracle hit this on
  2026-09-23: its shared target had built `tapstone-sim` from a scratch `git archive` copy that had
  since been deleted, so the worktree's tests read decks from a dead path and one failed. That was
  the lucky direction. **Had the other path still existed, the failure would have been a false
  green**, testing files from a different tree than the one under review. Use one target per tree,
  or a fresh one for any verdict that matters.

- **A skip guard needs a floor on what it lets through.** A check that skips cases it judges
  inapplicable can skip all of them and pass having checked nothing. Two instances: the per-chip lint
  arm above that skipped the one chip the issue was about, and on 2026-09-25 an arena control whose
  "game ended while dark" guard read the phase *after* the revival, when every match is over, so it
  skipped 40 of 40 cases and stayed green. Only a perturbation exposed it. Read the skip condition at
  the moment it applies, and assert a minimum number of cases evaluated (that control now requires
  ≥ 30 of 40). **And count the condition from its own source.** A floor that infers
  its condition from a derived value can be satisfied by coincidence: a "match 2 started in match 1's
  second" floor counted `id == previous + 1`, which is also the natural id of the *next* second
  whenever the previous second is even (ids are `node << 24 ^ unix`). It passed with the fix deleted.
  It now counts the journaled start times (PR #93).

- **Test the second of anything that can happen twice.** A harness that only ever plays one
  match can't see bugs in how consecutive matches meet. On 2026-09-25 the desk harness ran two
  matches back to back for the first time, and within minutes found two arena bugs that every
  follower-level test had missed. A voided match re-claimed in the same second got the **same id**,
  because ids come from the unix second, so the old match's stop frame voided the new one in a loop.
  And the arena applied acks and stops to the running match whatever match their header named. Several
  earlier stale-frame findings had also been follower-level only for the same reason. Any change to the
  match protocol belongs in a multi-match run (`tests/rematch.rs`), with lost frames.

- **A merge's success is the new ancestry, not the absence of conflict output.** On 2026-09-26 a lead
  merged main into a branch and grepped for conflicted files. There were none, so it committed and pushed.
  The merge had **aborted**: untracked files in the worktree would have been overwritten, and git printed
  "Aborting" and left the tree untouched. The empty conflict list read as clean, and "nothing to commit"
  read as nothing left to do. GitHub still said the PR had conflicts. After any merge, assert
  `git merge-base --is-ancestor <what you merged> HEAD`, and treat a non-zero `git merge` exit as a stop.

- **A long-lived log's last line is not this run's result.** An overnight watcher waited for "DONE" in a
  lane's log and fired at once: the line came from the lane's *previous* run, and the new run had already
  died of a usage limit without writing anything. The watcher was blind in both directions. Key a watcher
  to a marker this run writes (a run id), or to the output file this run created. **And check that a
  freshly launched headless run produces output** (two size samples, and a grep for "out of usage")
  before trusting that it's working.

- **Roblox Studio has two traps an agent can't see from the process table** (2026-09-26):
  - Studio launched through Vinegar with a bare `.rbxl` path sits on its **start page**, with the path
    in its argv, so `ps` looks right. The process runs and StudioMCP registers it, but every call answers
    "Place is not open". Launch with `-task EditFile -localPlaceFile 'Z:\…\Tapstone.rbxl'`, and confirm
    with an `execute_luau` that reads the place.
  - StudioMCP allows **one bridge** on port 13469. Tool calls that time out leave **orphan
    `bwrap … prefixes/mcp-bridge` sandboxes** adopted by systemd. They keep the port or block the next
    registration, so every later tool reports "no Studio registered", which is false. Kill the orphans
    by pid, and have every tool close its bridge in a `finally`.

- **Judge a protocol invariant against the history that survived, not the frames that were sent**
  (#173, 2026-09-27). A lossy dark-rejoin run reported one tap committed twice in 3 of 80 cases and
  reused lseqs in 12, all while converging. Every one was #160's rewind: the arena's last commit
  reached only a seat that then rebooted, the interim arbitrated that mseq itself, and the revived
  arena dropped its copy. The harness's ledger kept the first commit sent at each mseq, so it
  counted a record that no shrine and no journal held any more. A commit now counts only if its
  hash is the agreed chain's at its mseq. The check **fails closed** when that chain does not cover
  every mseq sent, since a lagging chain would otherwise make it see nothing. Removing the interim's
  dedupe still turns it red, so it can still see a real double commit.

## Handing a belief to someone who will check it

Offer a prediction *as a prediction*. Twice in one day a lane found the missing half of an argument
because it was handed "here is what I think survives, and I want you to check rather than take it
from me". The same words offered as a finding invite confirmation instead of falsification, and in
both cases the instruction to verify mattered more than the accuracy of what was being verified.
