"""Bundle pinned model snapshots into a self-contained Hugging Face cache."""

import argparse
import json
import shutil
from pathlib import Path

from huggingface_hub import hf_hub_download, try_to_load_from_cache


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache-dir", default=None, help="Optional existing Hub cache to reuse")
    parser.add_argument("--output-dir", default="docker/model-cache", help="Destination HF_HOME")
    parser.add_argument("--offline", action="store_true", help="Require all files in the existing cache")
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name("model-manifest.json").read_text())
    destination = Path(args.output_dir).resolve()
    hub = destination / "hub"
    for model in manifest["models"]:
        repo = model["repo_id"]
        revision = model["revision"]
        folder = hub / ("models--" + repo.replace("/", "--"))
        for filename in model["files"]:
            source = try_to_load_from_cache(repo, filename, revision=revision, cache_dir=args.cache_dir)
            target = folder / "snapshots" / revision / filename
            if isinstance(source, str) and Path(source).is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                if Path(source).resolve() != target.resolve():
                    shutil.copyfile(source, target)
            else:
                if args.offline:
                    raise RuntimeError(f"Missing cached model file: {repo}@{revision}/{filename}")
                hf_hub_download(repo, filename, revision=revision, cache_dir=str(hub))
            if not target.is_file() or target.stat().st_size == 0:
                raise RuntimeError(f"Incomplete model bundle: {repo}/{filename}")
        refs = folder / "refs"
        refs.mkdir(parents=True, exist_ok=True)
        (refs / "main").write_text(revision, encoding="utf-8")
        print(f"Bundled {repo}@{revision}", flush=True)
    (destination / "model-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
