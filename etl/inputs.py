"""
Manual source files: kept in a private R2 bucket instead of git.

    python -m etl.inputs push     # after a manual download: upload new/changed files
    python -m etl.inputs pull     # fetch any that are missing from data/raw/ (CI does this)
    python -m etl.inputs status
    python -m etl.inputs mirror   # copy downloads that refuse CI (MIRRORED) into the bucket

A few sources can't be downloaded by a script (SEDA gates its files behind a
download page; see sources/seda.py). They're downloaded once by hand into
data/raw/ and pushed here, so the repo stays free of large data and CI can
rebuild without a person.

MIRRORS. Other files download fine from a laptop but are refused from cloud
machines (FEMA answers GitHub's runners with 403). util.http_get falls back to
mirror/{its cache file name} in this bucket when a download fails, so pushing
the cached copy from data/raw/ is the whole fix. They're re-pushed by hand
(`mirror`) when the source publishes a new version.

The bucket (R2_INPUTS_BUCKET) has NO public access:
these are third-party files we use, not ours to redistribute. Credentials:
etl/r2.py.
"""

from __future__ import annotations

import sys

from . import config, r2
from .util import get_logger

log = get_logger("inputs")

PREFIX = "raw/"
# Every file a build needs that no script can download. Add one here when a
# new manual source appears, and push it.
MANUAL = [
    "seda_county_pool_cs_6.0.csv",    # county pipeline (sources/seda.py)
    "seda_geodist_pool_cs_6.0.csv",   # tracts: school districts (tracts/schools.py)
    "seda_school_pool_cs_6.0.csv",    # tracts: schools
]


# Downloads refused from CI, by cache-file prefix in data/raw/ (util._cache_path).
MIRRORED = [
    "nri_tracts__",   # FEMA NRI census-tract table (tracts/nri.py): 403 from GitHub runners
]
MIRROR_PREFIX = "mirror/"


def mirror() -> None:
    s3, bucket = r2.client("R2_INPUTS_BUCKET")
    remote = r2.etags(s3, bucket, MIRROR_PREFIX)
    for prefix in MIRRORED:
        found = sorted(config.RAW_DIR.glob(f"{prefix}*"))
        if not found:
            log.warning("%s*: not in data/raw/ — run the build locally first", prefix)
        for path in found:
            key = MIRROR_PREFIX + path.name
            if key in remote and _remote_md5(s3, bucket, key, remote[key], prefix="") == r2.md5(path):
                log.info("%s: mirror up to date", path.name)
                continue
            s3.upload_file(str(path), bucket, key, ExtraArgs={"Metadata": {"md5": r2.md5(path)}})
            log.info("%s: mirrored (%.0f MB)", path.name, path.stat().st_size / 1e6)


def _state():
    s3, bucket = r2.client("R2_INPUTS_BUCKET")
    return s3, bucket, r2.etags(s3, bucket, PREFIX)


def push() -> None:
    s3, bucket, remote = _state()
    for name in MANUAL:
        path = config.RAW_DIR / name
        if not path.exists():
            log.warning("%s: not in data/raw/, skipped", name)
            continue
        if _remote_md5(s3, bucket, name, remote.get(PREFIX + name)) == r2.md5(path):
            log.info("%s: up to date", name)
            continue
        # upload_file switches to multipart for big files; the ETag then isn't the MD5,
        # so record the MD5 as metadata and compare that too (status, push).
        s3.upload_file(str(path), bucket, PREFIX + name, ExtraArgs={"Metadata": {"md5": r2.md5(path)}})
        log.info("%s: uploaded (%.0f MB)", name, path.stat().st_size / 1e6)


def _remote_md5(s3, bucket: str, name: str, etag: str | None, prefix: str = PREFIX) -> str | None:
    if etag is None:
        return None
    if "-" not in etag:
        return etag
    return s3.head_object(Bucket=bucket, Key=prefix + name).get("Metadata", {}).get("md5")


def pull() -> None:
    s3, bucket, remote = _state()
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    missing = []
    for name in MANUAL:
        path = config.RAW_DIR / name
        if path.exists():
            log.info("%s: already in data/raw/", name)
            continue
        if PREFIX + name not in remote:
            missing.append(name)
            continue
        s3.download_file(bucket, PREFIX + name, str(path))
        log.info("%s: downloaded (%.0f MB)", name, path.stat().st_size / 1e6)
    if missing:
        raise SystemExit(f"Not in {bucket}: {', '.join(missing)} — download by hand and `python -m etl.inputs push`")


def status() -> None:
    s3, bucket, remote = _state()
    for name in MANUAL:
        path = config.RAW_DIR / name
        local = r2.md5(path) if path.exists() else None
        rem = _remote_md5(s3, bucket, name, remote.get(PREFIX + name))
        state = ("missing everywhere" if not local and not rem else "only local — push it" if not rem
                 else "only in R2" if not local else "same" if local == rem else "DIFFERENT")
        print(f"{name:34} {state}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"push": push, "pull": pull, "status": status, "mirror": mirror}.get(cmd, lambda: sys.exit(__doc__))()
