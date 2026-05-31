"""Pre-render the FastAPI eval viewer into a static site for GitHub Pages.

Imports the *real* endpoint functions from app.py so the emitted JSON is
byte-identical to what the server returns — no analytics logic is reimplemented
here. Run from this directory:

    python build_static.py /path/to/eyeball-viewer

Emits, under the output dir:
  data/summary.json
  data/throughput.json
  data/correlation.json
  data/episodes/<policy>__<task>.json
  data/episode_videos/<policy>__<task>__<episode>.json
  data/episode_compare/<task>__<episode>.json
  videos_manifest.tsv   (source<TAB>dest — fed to the parallel ffmpeg pass)

The slug scheme MUST match staticUrlFor() in app.js. We assert injectivity so a
collision fails the build loudly rather than silently overwriting a file.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

import app  # the real FastAPI module; importing registers routes but starts no server
import parser as eval_parser


def slugify(s: str) -> str:
    """Filesystem/URL-safe slug. Mirrors slugify() in app.js exactly."""
    return re.sub(r"[^A-Za-z0-9]+", "-", str(s)).strip("-")


_seen_slugs: dict[str, dict[str, str]] = {}


def slug_checked(bucket: str, value: str) -> str:
    """Slug `value`, asserting no two distinct values collide within `bucket`."""
    s = slugify(value)
    seen = _seen_slugs.setdefault(bucket, {})
    if s in seen and seen[s] != value:
        raise SystemExit(
            f"Slug collision in {bucket!r}: {value!r} and {seen[s]!r} -> {s!r}"
        )
    seen[s] = value
    return s


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, separators=(",", ":")))


def resolve_video_slots(data: dict, policy: str, task: str, episode: str):
    """Return [(label, out_filename, source_path_or_None, exists, relative_path)].

    Reuses app's external-replay resolver and the parser's slot logic so the set
    of slots matches what api_episode_videos would report.
    """
    entry = data.get(policy, {}).get(task)
    if entry is None or entry.get("source_csv") is None:
        return []
    csv_path = app.RECORDINGS_ROOT / entry["source_csv"]
    if not csv_path.exists():
        return []
    episode_dir = csv_path.parent / episode

    external = app._find_external_replay(policy, csv_path, episode)
    if external is not None:
        return [("Replay", "replay.mp4", external, True, app.EXTERNAL_REPLAY_FILE)]

    slots = eval_parser.video_slots_for_episode(policy, episode_dir)
    out = []
    for s in slots:
        rel = s["relative_path"]
        src = (episode_dir / rel) if s["exists"] else None
        out.append((s["label"], Path(rel).name, src, s["exists"], rel))
    return out


def main(out_dir: Path) -> None:
    data_dir = out_dir / "data"
    videos_dir = out_dir / "videos"
    manifest_lines: list[str] = []

    # ---- Global endpoints (verbatim from the API) ----
    write_json(data_dir / "summary.json", app.api_summary())
    write_json(data_dir / "throughput.json", app.api_throughput())
    write_json(data_dir / "correlation.json", app.api_correlation())

    checkpoints = app._load_checkpoints()
    summary = app.api_summary()
    policies = summary["policies"]

    # Pre-slug every policy/task once so collisions are caught up front.
    for p in policies:
        slug_checked("policy", p)
    for t in summary["tasks"]:
        slug_checked("task", t)

    n_pt = n_ep = n_vid = 0
    compare_done: set[tuple[str, str]] = set()

    for policy in policies:
        pslug = slug_checked("policy", policy)
        for task, entry in checkpoints.get(policy, {}).items():
            tslug = slug_checked("task", task)
            ep_json = app.api_episodes(policy=policy, task=task)
            write_json(data_dir / "episodes" / f"{pslug}__{tslug}.json", ep_json)
            n_pt += 1

            episodes = [e["episode_dir"] for e in ep_json.get("episodes", [])]
            for episode in episodes:
                eslug = slug_checked("episode", episode)

                # episode_compare is keyed by (task, episode) — emit once.
                ckey = (task, episode)
                if ckey not in compare_done:
                    compare_done.add(ckey)
                    cmp_json = app.api_episode_compare(task=task, episode=episode)
                    write_json(
                        data_dir / "episode_compare" / f"{tslug}__{eslug}.json",
                        cmp_json,
                    )

                # Resolve video slots, bake a clean relative URL per existing slot,
                # and queue the source->dest copy/encode in the manifest.
                slots_out = []
                for label, fname, src, exists, rel in resolve_video_slots(
                    checkpoints, policy, task, episode
                ):
                    slot = {"label": label, "relative_path": rel, "exists": exists}
                    if exists and src is not None and src.exists():
                        dest_rel = f"videos/{pslug}/{tslug}/{eslug}/{fname}"
                        slot["url"] = dest_rel
                        manifest_lines.append(f"{src}\t{out_dir / dest_rel}")
                        n_vid += 1
                    slots_out.append(slot)

                write_json(
                    data_dir / "episode_videos" / f"{pslug}__{tslug}__{eslug}.json",
                    {"slots": slots_out, "episode_dir_exists": True},
                )
                n_ep += 1

    (out_dir / "videos_manifest.tsv").write_text("\n".join(manifest_lines) + "\n")
    print(
        f"Wrote JSON: {n_pt} (policy,task) episode files, {n_ep} episode-video files, "
        f"{len(compare_done)} compare files."
    )
    print(f"Queued {n_vid} videos in {out_dir / 'videos_manifest.tsv'}")
    print(f"Output dir: {out_dir}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python build_static.py <output_dir>")
    main(Path(sys.argv[1]).resolve())
