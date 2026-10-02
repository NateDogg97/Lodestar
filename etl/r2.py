"""
Cloudflare R2 access for the ETL (S3-compatible API, via boto3).

Two buckets (plan §9 Phase 8c, "Data hosting"):
    R2_BUCKET          public, behind data.lodestarmap.com: what the app reads
                       (tracts/upload.py)
    R2_INPUTS_BUCKET   private, no public access: source files that can only be
                       downloaded by hand, so CI can get them (inputs.py)

Credentials (etl/.env locally, repository secrets in CI): R2_ACCOUNT_ID,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY — an R2 API token with Object Read &
Write on both buckets.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from . import config  # noqa: F401 — loads etl/.env


def client(bucket_var: str):
    """(boto3 S3 client, bucket name) for the bucket named by env var `bucket_var`."""
    import boto3  # only R2 steps need it

    names = ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", bucket_var)
    missing = [k for k in names if not os.environ.get(k, "").strip()]
    if missing:
        raise SystemExit(f"Missing in etl/.env (or CI secrets): {', '.join(missing)} (see etl/.env.example)")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID'].strip()}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"].strip(),
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"].strip(),
        region_name="auto",
    )
    return s3, os.environ[bucket_var].strip()


def etags(s3, bucket: str, prefix: str = "") -> dict[str, str]:
    """key -> ETag (the MD5 of a single-part upload) for every object under prefix."""
    out: dict[str, str] = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            out[obj["Key"]] = obj["ETag"].strip('"')
    return out


def md5(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
