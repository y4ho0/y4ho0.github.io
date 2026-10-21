#!/usr/bin/env python3
"""Build deterministic, complete WOFF2 web subsets from the official Screen TTF.

Usage:
  uv run --with fonttools --with brotli python scripts/build-wenkai.py /path/to/LXGWWenKaiScreen-v1.530.ttf

Only the generated web fonts are distributed. No source TTF or network request is
needed at site build time. The pinned upstream OFL.txt accompanies the outputs.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor
import hashlib
import logging
import os
from pathlib import Path

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "public/fonts/lxgw-wenkai-screen"
CSS = ROOT / "src/styles/wenkai.css"
VERSION = "1.530"
SOURCE_URL = f"https://github.com/lxgw/LxgwWenKai-Screen/releases/download/v{VERSION}/LXGWWenKaiScreen.ttf"
LICENSE_URL = f"https://raw.githubusercontent.com/lxgw/LxgwWenKai-Screen/v{VERSION}/OFL.txt"
SOURCE_SHA256 = "abd13364163e3cd84372b333f2fdcee9efb848634668f1c0ce5788dcd059ee61"
CHUNK_SIZE = 256


def unicode_points(font: TTFont) -> set[int]:
    return set().union(*(set(getattr(table, "cmap", {})) for table in font["cmap"].tables if table.isUnicode()))


def variation_pairs(font: TTFont) -> set[tuple[int, int]]:
    return {
        (selector, base)
        for table in font["cmap"].tables if table.format == 14
        for selector, mappings in table.uvsDict.items()
        for base, _glyph in mappings
    }


def unicode_range(points: tuple[int, ...]) -> str:
    """Compress only assigned original codepoints, never gaps between them."""
    ranges = []
    start = end = points[0]
    for point in points[1:]:
        if point == end + 1:
            end = point
        else:
            ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
            start = end = point
    ranges.append(f"U+{start:X}" if start == end else f"U+{start:X}-{end:X}")
    return ", ".join(ranges)


def build_chunk(task: tuple[str, int, tuple[int, ...]]) -> tuple[str, int, str]:
    source, index, points = task
    logging.getLogger("fontTools.subset").setLevel(logging.ERROR)
    filename = f"subset-{index:03d}.woff2"
    target = OUTPUT / filename
    temporary = target.with_suffix(".woff2.tmp")
    options = subset.Options()
    options.flavor = "woff2"
    options.recalc_timestamp = False
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.layout_features = ["*"]
    options.layout_closure = True
    options.notdef_glyph = True
    options.notdef_outline = True
    options.ignore_missing_unicodes = True  # UVS selectors live in cmap format 14, not a normal cmap.
    try:
        with TTFont(source, recalcTimestamp=False, lazy=True) as font:
            expected_variations = {pair for pair in variation_pairs(font) if pair[1] in points}
            selectors = {selector for selector, _base in expected_variations}
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=set(points) | selectors)
            subsetter.subset(font)
            font.flavor = "woff2"
            font.save(temporary, reorderTables=True)
        with TTFont(temporary, recalcTimestamp=False, lazy=True) as result:
            if unicode_points(result) != set(points):
                raise ValueError(f"Unicode coverage changed in {filename}")
            if variation_pairs(result) != expected_variations:
                raise ValueError(f"Unicode variation sequences changed in {filename}")
        temporary.replace(target)
        return filename, target.stat().st_size, unicode_range(points)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Unmodified official LXGWWenKaiScreen-v1.530.ttf")
    args = parser.parse_args()
    source = args.source.resolve(strict=True)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    if source_hash != SOURCE_SHA256:
        parser.error(f"Input SHA-256 does not match the pinned official v{VERSION} release: {source_hash}")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    if not (OUTPUT / "OFL.txt").is_file():
        parser.error(f"Keep the upstream license at {OUTPUT / 'OFL.txt'} before generating fonts ({LICENSE_URL})")

    with TTFont(source, recalcTimestamp=False, lazy=True) as font:
        if font["OS/2"].usWeightClass != 400 or font["name"].getDebugName(1) != "LXGW WenKai Screen":
            parser.error("Input must be the official Screen Regular font (Medium outlines mapped to 400).")
        points = sorted(unicode_points(font))
        variations = variation_pairs(font)
    chunks = [tuple(points[start:start + CHUNK_SIZE]) for start in range(0, len(points), CHUNK_SIZE)]
    tasks = [(str(source), index, chunk) for index, chunk in enumerate(chunks)]
    workers = min(4, os.cpu_count() or 1)
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = []
        for result in pool.map(build_chunk, tasks):
            results.append(result)
            if len(results) % 32 == 0 or len(results) == len(tasks):
                print(f"Built {len(results)}/{len(tasks)} subsets", flush=True)

    css = [
        "/* Generated by scripts/build-wenkai.py; do not edit individual ranges.",
        f" * Official LXGW WenKai Screen v{VERSION}; SIL OFL 1.1.",
        " * Screen Regular uses the original WenKai Medium outlines, mapped to weight 400.",
        " * Copyright and license: /fonts/lxgw-wenkai-screen/OFL.txt */", "",
    ]
    for filename, _size, ranges in results:
        css.extend([
            "@font-face {",
            '  font-family: "LXGW WenKai Screen";',
            "  font-style: normal;",
            "  font-weight: 400;",
            "  font-display: swap;",
            f'  src: url("/fonts/lxgw-wenkai-screen/{filename}") format("woff2");',
            f"  unicode-range: {ranges};",
            "}", "",
        ])
    CSS.write_text("\n".join(css), encoding="utf-8")
    expected_files = {filename for filename, _size, _ranges in results}
    for previous in OUTPUT.glob("subset-*.woff2"):
        if previous.name not in expected_files:
            previous.unlink()

    total = sum(size for _filename, size, _ranges in results)
    largest = max(size for _filename, size, _ranges in results)
    css_size = CSS.stat().st_size
    license_size = (OUTPUT / "OFL.txt").stat().st_size
    readme = f"""# LXGW WenKai Screen web fonts

These self-hosted WOFF2 subsets are generated directly from the official,
unmodified **LXGW WenKai Screen v{VERSION}** TTF. No third-party font build is used.

- Source: {SOURCE_URL}
- Source SHA-256: `{source_hash}`
- Upstream license: {LICENSE_URL} (complete copy in `OFL.txt`).
- Font copyright: LXGW and The Klee Project Authors; **SIL Open Font License 1.1**.
- Family: `LXGW WenKai Screen`; style: `Regular`; CSS weight: **400**.
  Upstream intentionally maps the original WenKai **Medium** outlines to Screen
  Regular. This is the requested screen-reading Medium appearance, without
  synthesizing an additional Medium weight.
- Scope: web rendering only; these subsets are not offered as desktop font downloads.

## Rebuild

Download the pinned TTF separately; do not commit it. From the repository root:

```bash
uv run --with fonttools --with brotli python scripts/build-wenkai.py /tmp/LXGWWenKaiScreen-v{VERSION}.ttf
```

This generation used fontTools **{fontTools.__version__}** and Brotli **{brotli.__version__}**.
For the same tool versions, replace the two `--with` arguments with
`--with fonttools=={fontTools.__version__} --with brotli=={brotli.__version__}`.
The script checks the source hash, fixes font timestamps, sorts all original cmap
codepoints, and groups at most {CHUNK_SIZE} codepoints per numbered subset. It keeps
OpenType layout/composite closure, original font names and license metadata, and
the variation-selector mappings associated with each subset's base characters.
Each generated font is reopened to verify exact cmap and variation coverage.

All **{len(points):,}** original Unicode cmap codepoints and **{len(variations)}** Unicode variation
sequences are covered. `src/styles/wenkai.css` contains the exact compressed
`unicode-range` values and same-origin font URLs. Browsers download only subsets
needed for the characters on a page. No network request or font-generation tool
is used by the normal Astro build, and there is no added Node dependency.

## Generated footprint

- WOFF2 files: **{len(results)}**.
- Total WOFF2 bytes: **{total:,}** ({total / 1024 / 1024:.2f} MiB).
- Largest subset: **{largest:,}** bytes ({largest / 1024:.1f} KiB).
- Generated CSS: **{css_size:,}** bytes.
- OFL license: **{license_size:,}** bytes.

The body font must not replace KaTeX's native math families or the code font.
"""
    (OUTPUT / "README.md").write_text(readme, encoding="utf-8")
    print(f"Verified {len(points):,} codepoints and {len(variations)} variation sequences; "
          f"{len(results)} WOFF2 files, {total:,} bytes; largest {largest:,} bytes; CSS {css_size:,} bytes.")


if __name__ == "__main__":
    main()
