"""
Upload published tract files to Cloudflare R2 (plan §9 Phase 8c, "Data hosting").

    python -m etl.tracts.upload --dry-run   # what would change
    python -m etl.tracts.upload             # sync public/data/tracts/ -> bucket tracts/
    python -m etl.tracts.upload --cors      # (once) let the app's origins read the bucket
                                            # (needs an Admin token; or set the same rule in the
                                            # dashboard: bucket → Settings → CORS policy)

The app reads {NEXT_PUBLIC_DATA_URL}/tracts/… (src/lib/tracts/index.ts), so the
bucket mirrors public/data/tracts/ under the key prefix `tracts/`. Run
`python -m etl.tracts.publish` first.

A sync uploads only files whose MD5 differs from the object's ETag (R2, like
S3, uses the MD5 as the ETag of a single-part upload), and uploads index.json
LAST: the index lists which counties can be explored, so it must never name a
county whose files aren't up yet. Nothing in the bucket is deleted.

Credentials: see etl/r2.py (R2_BUCKET is the public data bucket).
"""

from __future__ import annotations

import argparse

from .. import r2
from ..util import get_logger
from .publish import PUBLISH_DIR

log = get_logger("tracts.upload")

PREFIX = "tracts/"
# Short caches: the app's service worker keeps its own copy (stale-while-
# revalidate), and a rebuilt county should reach browsers within the hour.
CACHE_COUNTY = "public, max-age=3600"
CACHE_INDEX = "public, max-age=300"
ORIGINS = ["https://www.lodestarmap.com", "https://lodestarmap.com", "http://localhost:3000"]


def set_cors(s3, bucket: str) -> None:
    s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": ORIGINS, "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 86400,
    }]})
    log.info("CORS on %s: GET from %s", bucket, ", ".join(ORIGINS))


def sync(dry_run: bool) -> None:
    files = sorted(PUBLISH_DIR.glob("*.json"), key=lambda p: p.name == "index.json")  # index last
    if not any(p.name == "index.json" for p in files):
        raise SystemExit(f"No index.json in {PUBLISH_DIR}: run `python -m etl.tracts.publish` first")
    s3, bucket = r2.client("R2_BUCKET")
    remote = r2.etags(s3, bucket, PREFIX)
    changed = [p for p in files if remote.get(PREFIX + p.name) != r2.md5(p)]
    size = sum(p.stat().st_size for p in changed)
    log.info("%s: %d local files, %d changed (%.1f MB)%s", bucket, len(files), len(changed), size / 1e6,
             " — dry run" if dry_run else "")
    if dry_run:
        return
    for i, p in enumerate(changed, 1):
        s3.put_object(Bucket=bucket, Key=PREFIX + p.name, Body=p.read_bytes(), ContentType="application/json",
                      CacheControl=CACHE_INDEX if p.name == "index.json" else CACHE_COUNTY)
        if i % 100 == 0:
            log.info("uploaded %d/%d", i, len(changed))
    log.info("uploaded %d files to %s/%s", len(changed), bucket, PREFIX)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="list what would upload")
    ap.add_argument("--cors", action="store_true", help="set the bucket's CORS rule for the app's origins")
    args = ap.parse_args()
    if args.cors:
        set_cors(*r2.client("R2_BUCKET"))
        return
    sync(args.dry_run)


if __name__ == "__main__":
    main()
