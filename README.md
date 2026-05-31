# Eyeball Eval Viewer

A fully static viewer for robot-policy eval results (success rates, throughput,
per-episode video, and policy correlation). Originally a FastAPI app; this repo
is the **pre-rendered static build** so it can be hosted for free on GitHub
Pages with no server.

## How it works

The FastAPI endpoints were pure functions of `checkpoints.txt` + the eval CSVs,
so `build_static.py` imports the real endpoint code and dumps identical JSON to
`data/`. The frontend (`app.js`) is unchanged except for one translation layer
(`staticUrlFor`) that maps each old `/api/...` request to its static file, and
it reads a baked-in relative `url` for each episode video.

```
index.html, app.js, style.css, mike.png   frontend (relative paths only)
data/summary.json | throughput.json | correlation.json
data/episodes/<policy>__<task>.json
data/episode_videos/<policy>__<task>__<episode>.json
data/episode_compare/<task>__<episode>.json
videos/<policy>/<task>/<episode>/<file>.mp4   only the clips the viewer serves
build_static.py                                regenerates data/ + the video manifest
```

Only the **1747** videos the viewer actually serves are included (~635 MB) — the
viewer prefers a single combined `replay.mp4` over raw left/right footage for the
eyeball/peripheral/mono policies, so unused clips are never shipped.

## Rebuilding from a new bundle

```sh
# from the original bundle's recordings/eval_viewer dir (needs fastapi):
python build_static.py /path/to/this/repo
# then copy the referenced videos listed in videos_manifest.tsv:
awk -F'\t' 'NF==2' videos_manifest.tsv | \
  xargs -P8 -d'\n' -I{} bash -c 'l="{}"; s="${l%%\t*}"; d="${l#*\t}"; mkdir -p "$(dirname "$d")"; cp "$s" "$d"'
```

## Hosting on GitHub Pages

Push to a repo, then **Settings → Pages → Build from branch → `main` / root**.
Served at `https://<user>.github.io/<repo>/`. The `.nojekyll` file is required so
GitHub serves the `data/` and `videos/` directories verbatim.

For a true subdomain like `eyeball-viewer.github.io` (free), create a GitHub
**organization** and use its user-site repo — no code changes needed since all
paths are relative.
