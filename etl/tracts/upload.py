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

Credentials (etl/.env; an R2 API token with Object Read & Write on the bucket):
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
"""

from __future__ import annotations

import argparse
import hashlib
import os

from ..util import get_logger
from .publish import PUBLISH_DIR

log = get_logger("tracts.upload")

PREFIX = "tracts/"
# Short caches: the app's service worker keeps its own copy (stale-while-
# revalidate), and a rebuilt county should reach browsers within the hour.
CACHE_COUNTY = "public, max-age=3600"
CACHE_INDEX = "public, max-age=300"
ORIGINS = ["https://www.lodestarmap.com", "https://lodestarmap.com", "http://localhost:3000"]


def _client():
    import boto3  # only the upload needs it

    missing = [k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET")
               if not os.environ.get(k, "").strip()]
    if missing:
        raise SystemExit(f"Missing in etl/.env: {', '.join(missing)} (see etl/.env.example)")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID'].strip()}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        region_name="auto",
    )
    return s3, os.environ["R2_BUCKET"].strip()


def _remote_etags(s3, bucket: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=PREFIX):
        for obj in page.get("Contents", []):
            out[obj["Key"]] = obj["ETag"].strip('"')
    return out


def set_cors(s3, bucket: str) -> None:
    s3.put_bucket_cors(Bucket=bucket, CORSConfiguration={"CORSRules": [{
        "AllowedOrigins": ORIGINS, "AllowedMethods": ["GET", "HEAD"], "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 86400,
    }]})
    log.info("CORS on %s: GET from %s", bucket, ", ".join(ORIGINS))


def sync(dry_run: bool) -> None:
    from .. import config  # noqa: F401 — loads etl/.env

    files = sorted(PUBLISH_DIR.glob("*.json"), key=lambda p: p.name == "index.json")  # index last
    if not any(p.name == "index.json" for p in files):
        raise SystemExit(f"No index.json in {PUBLISH_DIR}: run `python -m etl.tracts.publish` first")
    s3, bucket = _client()
    remote = _remote_etags(s3, bucket)
    changed = [p for p in files if remote.get(PREFIX + p.name) != hashlib.md5(p.read_bytes()).hexdigest()]
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
        from .. import config  # noqa: F401 — loads etl/.env
        set_cors(*_client())
        return
    sync(args.dry_run)


if __name__ == "__main__":
    main()
