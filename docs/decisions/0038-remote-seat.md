# 0038: A remote seat, reached through a tunnel
Date: 2026-09-26 · JP's ruling (brainstorm: the Roblox prototype is "cross-play with real table"; the Roblox player "plays a seat remotely"; approved: "go ahead")

## The rule

- **A match may have one remote seat.** One seat is a real shrine with paper cards; the other is played
  from somewhere else (first, from Roblox). The remote seat is a **virtual shrine inside the arena
  process**: the same `DeskShrine` follower desk mode uses, set manual, holding a deck list as virtual
  copies (draws are taps, 0036). Its taps arrive over HTTP as a choice from the engine's own menu.
- **The arena still decides everything (0028, 0037).** A remote client renders the arena's view JSON,
  proposes, and is refused like any shrine. It holds no rules and no state.
- **The remote seat is reached through a tunnel that exposes only `/remote/*`**, on a listener of its
  own, never the board's. A tunnel's requests arrive from localhost, so the board listener's
  loopback check on `/dev/*` would pass them: the two can never share a port.
- **Access is by a join code, then a token for exactly one match and seat.** The arena prints and
  the board shows a 6-character code (the shrine's station screen shows it too, once smol carries
  it). Redeeming it returns a random bearer token that dies with the match. Ten wrong codes throttle
  the source that sent them (amended 2026-09-27, below).

## What it changes

0028 says nothing on the table depends on a server off the table. **That still holds for a table of
shrines:** the remote mode is opt-in, per match, and a two-shrine table runs offline as before. A match
with a remote seat depends on the tunnel. If the tunnel drops, the remote seat stops proposing, and the
match waits, as it waits for a shrine that goes quiet.

## Why

JP's ruling that Tapstone is cross-play by ethos (0037) extends past the table: a player without cards
or a shrine can still take a seat against one who has them. Keeping the remote seat inside the arena
means the lossy-radio recovery work (#95–#101) never sees it, because its frames never touch the radio.
It also reuses the manual desk seat (#108) and the move menu (`legal_choices`), so no remote client can
express a move the engine would refuse.

## Amendment 2026-09-27: the wrong-code budget is each source's

As first built, ten wrong codes locked joining **for the whole table** until the next match (`423`), so
anyone holding the tunnel URL could lock the real seats out with ten guesses. The budget is now each
source's: ten wrong codes at full speed, then that source waits 1 s after its next wrong code, then 2,
4, … up to 60 s (`429` with `Retry-After`), and codes it sends while waiting aren't looked at. Another
source is never charged for them, so a real seat joins on its first try. A source is Cloudflare's
`CF-Connecting-IP` behind a loopback peer (the tunnel), an IPv6 client's /64, or else the peer itself;
a header from any other peer is ignored. A match remembers 1024 sources; past that, new wrong-guessers
share one record. Brute force stays hopeless: about one guess a minute per source against 32^6 codes.
The Roblox client already retries `429`, so a seat that shares a throttled source waits it out.
