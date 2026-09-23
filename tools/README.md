# Screenshot tools

Regenerate the portfolio's `img/*.png` (all headless — no window opens):

- **TurnZero** (live site): `LS='{"tz_tour_seen":"1"}' node tools/shot.js https://turn-zero-nine.vercel.app/ img/turnzero.png 420 860 2000`
- **Pairings** (local copy, demo data): serve `~/Desktop/pairings` on `127.0.0.1:8765` (`python3 -m http.server 8765 --bind 127.0.0.1`), then `FAKE_CONFIG=tools/pairings-demo-config.js node tools/shot.js http://127.0.0.1:8765/ img/pairings.png 420 860 2500`
- **Brewhouse** (public phone app): `node tools/brewhouse-shot.js img/brewhouse.png`
- **Pawmodoro** (off-screen Qt): see the header of `tools/pawmodoro-shot.py`; run it with a throwaway `HOME` under `.work/`.
