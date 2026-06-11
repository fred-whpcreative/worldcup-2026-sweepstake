# ⚽ World Cup 2026 Sweepstake

A self-contained local sweepstake app for the 2026 FIFA World Cup (48 teams, USA/Canada/Mexico). Zero dependencies — just Node 18+.

```bash
node server.js
# → http://localhost:4026
```

## What it does

- **Participants & draw** — add names, hit *Run the draw*. Teams are ranked 1–48 by strength; every participant gets exactly one **top contender** (⭐ from the top-N pot), and the rest are dealt from shuffled strength bands so squads stay balanced. *Save group & lock* freezes the allocation.
- **Live results** — fixtures and scores sync from the [fixturedownload.com](https://fixturedownload.com) JSON feed (auto on boot, every 10 minutes in the browser, or via the *Sync results* button). As groups complete and knockout ties are decided, the feed fills in real teams; the app also resolves group winners/runners-up itself and propagates knockout winners down the official FIFA bracket. BBC Sport headlines show on the Matches tab.
- **Groups** — all 12 group tables with live standings and owner chips.
- **Bracket** — classic tournament tree (Round of 32 → Final + third place) showing who faces who, with each team's owner colour-dotted on the tie.
- **Manual results** — if the feed lags, enter scores on the Matches tab (knockout draws prompt for the penalties winner). Manual entries override the feed.

## Deploying a live read-only view (Vercel etc.)

The app detects hosts with ephemeral/read-only filesystems (`VERCEL`, or set `READONLY=1`) and switches to **live viewer** mode: the group loads from the committed `data/state-snapshot.json`, fixtures/scores are fetched from the feed into memory, and all editing endpoints return 403. Your local machine stays the admin copy.

To publish or update the live group:

```bash
npm run export   # copies data/state.json → data/state-snapshot.json
git commit -am "Update sweepstake snapshot" && git push
```

The host redeploys and the live view picks up the new snapshot. Note the snapshot (participant names + allocations) becomes public — that's the point of the live view.

## Files

- `server.js` — zero-dep Node server + API
- `public/` — frontend (vanilla JS)
- `data/state.json` — saved sweepstake (participants, allocation, manual results)
- `data/fixtures-seed.json` — offline fallback fixtures

To start a fresh sweepstake, stop the server and delete `data/state.json`.
