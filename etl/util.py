"""
Shared utilities: HTTP with caching and retry, FIPS handling, haversine distance.

The caching layer matters more than it looks. Several of these sources are slow
(NOAA is ~10,000 small files) and one of them is rate-limited (Census). Caching
raw responses to disk means you can iterate on parsing logic without re-hitting
anyone's API, and it means a failed run resumes instead of restarting.
"""

from __future__ import annotations

import hashlib
import io
import logging
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd
import requests

from . import config


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------


def get_logger(name: str) -> logging.Logger:
    """Consistent logger. Source modules print progress; the orchestrator prints summaries."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter("%(asctime)s  %(levelname)-7s  %(name)-22s  %(message)s",
                              datefmt="%H:%M:%S")
        )
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger


log = get_logger("util")


# ---------------------------------------------------------------------------
# HTTP with on-disk cache
# ---------------------------------------------------------------------------


_QUERY_RE = re.compile(r"\?[^\s'\"<>)\]]*")


def redact_query(text: str) -> str:
    """
    Strip query strings from any URL inside free text.

    requests embeds the full URL — including ?UserID=<key> — in every
    exception message ("... for url: https://..."). Anything that logs or
    re-raises one of those must pass it through here first.
    """
    return _QUERY_RE.sub("?<query redacted>", text)


class BadResponse(RuntimeError):
    """
    The server answered, but the body is not usable (empty, an error wrapped
    in a 200, wrong shape). Raised by http_get; never cached.
    """


def _cache_path(url: str, suffix: str = "", hint: str | None = None) -> Path:
    """
    Deterministic cache filename from the full URL (including query params).

    The readable prefix is built from the URL PATH only. The query string is
    deliberately excluded: it carries API keys (BEA puts the key in UserID,
    Census in key=) and a filename is the last place those should end up.
    The sha256 of the full URL is what disambiguates two calls to the same
    endpoint; the hint is purely cosmetic. Callers can pass their own hint.
    """
    digest = hashlib.sha256(url.encode()).hexdigest()[:16]
    if hint is None:
        path_only = url.split("?", 1)[0].split("#", 1)[0]
        hint = path_only.rstrip("/").split("/")[-1][:40] or "root"
    safe = "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in hint)[:60]
    return config.RAW_DIR / f"{safe}__{digest}{suffix}"


def http_get(
    url: str,
    params: dict[str, Any] | None = None,
    *,
    use_cache: bool = True,
    binary: bool = False,
    cache_hint: str | None = None,
    check: Callable[[Any], None] | None = None,
) -> bytes | str:
    """
    GET with retry, exponential backoff, and an on-disk cache.

    The cache key includes query params, so different API calls to the same
    endpoint cache separately. Delete data/raw/ to force a full refresh.

    `check(payload)` is an optional validator. It should raise (BadResponse,
    or anything) if the body is not usable — e.g. BEA wrapping an error in a
    200, Census answering with HTML. A rejected body is NEVER written to the
    cache, and a previously cached body that fails `check` is deleted and
    re-fetched. This is what stops one transient API error from poisoning
    every later run. A 204 or an empty body is rejected the same way.

    Rejections are not retried: they are deterministic answers from the
    server, not transport failures, and the caller decides what to do.

    Raises requests.HTTPError on 404 immediately, BadResponse on a rejected
    body, RuntimeError after exhausting retries on transport errors. Callers
    that expect a URL might legitimately 404 (probing for the latest vintage)
    should catch that explicitly.
    """
    full_url = url
    if params:
        prepared = requests.Request("GET", url, params=params).prepare()
        full_url = prepared.url or url

    cache_file = _cache_path(full_url, ".bin" if binary else ".txt", hint=cache_hint)

    if use_cache and cache_file.exists():
        cached = cache_file.read_bytes() if binary else cache_file.read_text(encoding="utf-8")
        try:
            _reject_if_unusable(cached, check)
        except Exception as exc:  # noqa: BLE001 - any rejection means re-fetch
            log.warning("cached response %s failed validation (%s); deleting and re-fetching",
                        cache_file.name, exc)
            cache_file.unlink(missing_ok=True)
        else:
            log.debug("cache hit  %s", cache_file.name)
            return cached

    last_error: str | None = None
    delay = config.HTTP_BACKOFF_SECONDS

    for attempt in range(1, config.HTTP_MAX_RETRIES + 1):
        try:
            response = requests.get(
                url,
                params=params,
                timeout=config.HTTP_TIMEOUT,
                headers={"User-Agent": config.HTTP_USER_AGENT},
            )
            # 404 is usually meaningful (vintage not published yet), so surface
            # it immediately rather than burning retries on it. Re-raise with a
            # redacted message: requests puts the full URL (query string and
            # all) in the default one.
            if response.status_code == 404:
                raise requests.HTTPError(f"404 Not Found: {url}", response=response)

            response.raise_for_status()

            if response.status_code == 204:
                raise BadResponse(f"204 No Content from {url}")

            payload = response.content if binary else response.text
            _reject_if_unusable(payload, check)   # raises BadResponse; not cached

            if use_cache:
                cache_file.parent.mkdir(parents=True, exist_ok=True)
                if binary:
                    cache_file.write_bytes(payload)
                else:
                    cache_file.write_text(payload, encoding="utf-8")

            return payload

        except BadResponse:
            raise

        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise
            last_error = redact_query(str(exc))
            log.warning("attempt %d/%d failed for %s: %s",
                        attempt, config.HTTP_MAX_RETRIES, url, last_error)
        except requests.RequestException as exc:
            last_error = redact_query(str(exc))
            log.warning("attempt %d/%d failed for %s: %s",
                        attempt, config.HTTP_MAX_RETRIES, url, last_error)

        if attempt < config.HTTP_MAX_RETRIES:
            time.sleep(delay)
            delay *= 2

    # `from None`: chaining the original exception would print its unredacted
    # message in the traceback. The redacted text is carried in this one.
    raise RuntimeError(
        f"GET failed after {config.HTTP_MAX_RETRIES} attempts: {url} — last error: {last_error}"
    ) from None


def _reject_if_unusable(payload: Any, check: Callable[[Any], None] | None) -> None:
    """Shared gate for fresh and cached bodies. Raises BadResponse."""
    if payload is None or len(payload) == 0 or (isinstance(payload, str) and not payload.strip()):
        raise BadResponse("empty response body")
    if check is not None:
        try:
            check(payload)
        except BadResponse:
            raise
        except Exception as exc:
            raise BadResponse(str(exc)) from exc


def expect_json(payload: Any) -> Any:
    """
    A ready-made `check` for JSON APIs: parses the body and returns the
    object, raising BadResponse with the first 300 chars on failure. Source
    modules layer their own shape checks on top of this.
    """
    import json

    text = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else payload
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise BadResponse(f"non-JSON response. First 300 chars:\n{text[:300]}") from exc


def http_get_zip_member(url: str, member_suffix: str) -> bytes:
    """
    Download a zip and return the first member whose name ends with member_suffix.

    Used for Census Gazetteer files, which ship as a zip containing one .txt.
    """
    blob = http_get(url, binary=True)
    assert isinstance(blob, bytes)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        matches = [n for n in zf.namelist() if n.lower().endswith(member_suffix.lower())]
        if not matches:
            raise FileNotFoundError(
                f"No member ending in {member_suffix!r} in {url}. "
                f"Contents: {zf.namelist()}"
            )
        return zf.read(matches[0])


# ---------------------------------------------------------------------------
# FIPS handling
# ---------------------------------------------------------------------------
# THE SINGLE MOST COMMON BUG IN THIS PIPELINE.
#
# County FIPS codes are 5-character STRINGS with meaningful leading zeros.
# San Francisco is "06075", not 6075. If any step lets pandas infer the dtype,
# it becomes an int, the leading zero vanishes, and every join against that
# column silently drops all ~180 counties in states with FIPS < 10
# (Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut,
# Delaware, DC, Florida, Georgia).
#
# The failure mode is nasty because it is partial: you still get 2,900 rows
# out, everything looks fine, and California is just... missing.
#
# Rule: every read_csv gets dtype=str on FIPS-like columns, and every FIPS
# passes through normalize_fips() before being used as a join key.


def normalize_fips(value: Any, width: int = 5) -> str | None:
    """
    Coerce anything FIPS-shaped into a zero-padded string of the given width.

    Handles the int-ification that happens when data passes through Excel or a
    careless read_csv. Returns None for missing/unparseable input so callers
    can drop those rows deliberately.
    """
    if value is None:
        return None
    if isinstance(value, float) and np.isnan(value):
        return None

    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "na", ""}:
        return None

    # Strip a trailing ".0" left behind by a float round-trip.
    if text.endswith(".0"):
        text = text[:-2]

    # Drop any non-digit decoration (some sources prefix with quotes or spaces).
    text = "".join(ch for ch in text if ch.isdigit())
    if not text:
        return None

    if len(text) > width:
        # Longer than expected — probably a tract or block GEOID. Take the
        # leading county portion, which is the first `width` digits.
        text = text[:width]

    return text.zfill(width)


def add_fips_column(
    df: pd.DataFrame,
    *,
    state_col: str | None = None,
    county_col: str | None = None,
    combined_col: str | None = None,
    out_col: str = "fips",
) -> pd.DataFrame:
    """
    Build a normalized 5-char `fips` column from either a combined code or a
    separate state+county pair (which is how the Census API returns it).
    """
    df = df.copy()
    if combined_col is not None:
        df[out_col] = df[combined_col].map(normalize_fips)
    elif state_col is not None and county_col is not None:
        df[out_col] = (
            df[state_col].map(lambda v: normalize_fips(v, 2)).fillna("")
            + df[county_col].map(lambda v: normalize_fips(v, 3)).fillna("")
        ).map(normalize_fips)
    else:
        raise ValueError("Provide either combined_col or both state_col and county_col")

    return df


# ---------------------------------------------------------------------------
# Census null sentinels
# ---------------------------------------------------------------------------


def clean_census_nulls(series: pd.Series) -> pd.Series:
    """
    Replace Census jam values (-666666666 and friends) with NaN.

    See config.CENSUS_NULL_SENTINEL_THRESHOLD for why this matters.
    """
    numeric = pd.to_numeric(series, errors="coerce")
    return numeric.mask(numeric <= config.CENSUS_NULL_SENTINEL_THRESHOLD)


# ---------------------------------------------------------------------------
# Geography math
# ---------------------------------------------------------------------------


EARTH_RADIUS_MILES = 3958.7613


def haversine_miles(
    lat1: np.ndarray | float,
    lon1: np.ndarray | float,
    lat2: np.ndarray | float,
    lon2: np.ndarray | float,
) -> np.ndarray:
    """
    Great-circle distance in miles. Vectorized over numpy arrays.

    Used for nearest-weather-station lookup in Phase 1, and it is the same
    function the Phase 5 "distance to airport/coast" columns will use.

    Accurate to well under a mile at these scales, which is far finer than
    anything we are measuring.
    """
    lat1r, lon1r, lat2r, lon2r = map(np.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2r - lat1r
    dlon = lon2r - lon1r
    a = np.sin(dlat / 2.0) ** 2 + np.cos(lat1r) * np.cos(lat2r) * np.sin(dlon / 2.0) ** 2
    return 2.0 * EARTH_RADIUS_MILES * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def nearest_points(
    target_lat: np.ndarray,
    target_lon: np.ndarray,
    source_lat: np.ndarray,
    source_lon: np.ndarray,
    k: int = 1,
) -> tuple[np.ndarray, np.ndarray]:
    """
    For each target point, find the k nearest source points.

    Returns (indices, distances_miles), both shaped (n_targets, k).

    Brute force: 3,144 counties x ~10,000 stations = 31M distance calculations,
    which numpy does in well under a second. A KD-tree would be faster but adds
    a scipy dependency for no practical gain at this scale. Revisit at tract
    scale (85,000 x 10,000 = 850M) where it will start to matter.
    """
    n_targets = len(target_lat)
    k = min(k, len(source_lat))

    idx_out = np.zeros((n_targets, k), dtype=int)
    dist_out = np.zeros((n_targets, k), dtype=float)

    # Chunk to keep peak memory sane.
    chunk = 256
    for start in range(0, n_targets, chunk):
        end = min(start + chunk, n_targets)
        # (chunk, n_sources) distance matrix
        d = haversine_miles(
            target_lat[start:end, None],
            target_lon[start:end, None],
            source_lat[None, :],
            source_lon[None, :],
        )
        part = np.argpartition(d, kth=k - 1, axis=1)[:, :k]
        part_d = np.take_along_axis(d, part, axis=1)
        order = np.argsort(part_d, axis=1)
        idx_out[start:end] = np.take_along_axis(part, order, axis=1)
        dist_out[start:end] = np.take_along_axis(part_d, order, axis=1)

    return idx_out, dist_out


# ---------------------------------------------------------------------------
# Interim file helpers
# ---------------------------------------------------------------------------


def write_interim(df: pd.DataFrame, name: str) -> Path:
    """
    Save a per-source tidy table to data/interim/.

    CSV rather than parquet, deliberately: these are meant to be opened and
    eyeballed during QA, and a 3,000-row CSV is trivially small.
    """
    path = config.INTERIM_DIR / f"{name}.csv"
    df.to_csv(path, index=False)
    log.info("wrote %s  (%d rows x %d cols)", path.name, len(df), len(df.columns))
    return path


def read_interim(name: str) -> pd.DataFrame:
    """Read back an interim table, preserving fips as a string."""
    path = config.INTERIM_DIR / f"{name}.csv"
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Run that source module first "
            f"(python -m etl.sources.{name.split('_')[0]})."
        )
    return pd.read_csv(path, dtype={"fips": str, "cbsa": str, "state_fips": str})


def describe_frame(df: pd.DataFrame, name: str) -> str:
    """Compact human-readable summary, used by every module's --probe output."""
    lines = [f"--- {name}: {len(df)} rows x {len(df.columns)} cols ---"]
    for col in df.columns:
        series = df[col]
        n_null = int(series.isna().sum())
        pct_null = 100.0 * n_null / max(len(series), 1)
        if pd.api.types.is_numeric_dtype(series) and series.notna().any():
            lines.append(
                f"  {col:<28} nulls={n_null:>5} ({pct_null:4.1f}%)  "
                f"min={series.min():>12,.2f}  med={series.median():>12,.2f}  "
                f"max={series.max():>12,.2f}"
            )
        else:
            sample = series.dropna().astype(str).head(3).tolist()
            lines.append(
                f"  {col:<28} nulls={n_null:>5} ({pct_null:4.1f}%)  e.g. {sample}"
            )
    return "\n".join(lines)
