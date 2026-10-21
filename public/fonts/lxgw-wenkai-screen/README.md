# LXGW WenKai Screen web fonts

These self-hosted WOFF2 subsets are generated directly from the official,
unmodified **LXGW WenKai Screen v1.530** TTF. No third-party font build is used.

- Source: https://github.com/lxgw/LxgwWenKai-Screen/releases/download/v1.530/LXGWWenKaiScreen.ttf
- Source SHA-256: `abd13364163e3cd84372b333f2fdcee9efb848634668f1c0ce5788dcd059ee61`
- Upstream license: https://raw.githubusercontent.com/lxgw/LxgwWenKai-Screen/v1.530/OFL.txt (complete copy in `OFL.txt`).
- Font copyright: LXGW and The Klee Project Authors; **SIL Open Font License 1.1**.
- Family: `LXGW WenKai Screen`; style: `Regular`; CSS weight: **400**.
  Upstream intentionally maps the original WenKai **Medium** outlines to Screen
  Regular. This is the requested screen-reading Medium appearance, without
  synthesizing an additional Medium weight.
- Scope: web rendering only; these subsets are not offered as desktop font downloads.

## Rebuild

Download the pinned TTF separately; do not commit it. From the repository root:

```bash
uv run --with fonttools --with brotli python scripts/build-wenkai.py /tmp/LXGWWenKaiScreen-v1.530.ttf
```

This generation used fontTools **4.67.0** and Brotli **1.2.0**.
For the same tool versions, replace the two `--with` arguments with
`--with fonttools==4.67.0 --with brotli==1.2.0`.
The script checks the source hash, fixes font timestamps, sorts all original cmap
codepoints, and groups at most 256 codepoints per numbered subset. It keeps
OpenType layout/composite closure, original font names and license metadata, and
the variation-selector mappings associated with each subset's base characters.
Each generated font is reopened to verify exact cmap and variation coverage.

All **47,883** original Unicode cmap codepoints and **41** Unicode variation
sequences are covered. `src/styles/wenkai.css` contains the exact compressed
`unicode-range` values and same-origin font URLs. Browsers download only subsets
needed for the characters on a page. No network request or font-generation tool
is used by the normal Astro build, and there is no added Node dependency.

## Generated footprint

- WOFF2 files: **188**.
- Total WOFF2 bytes: **12,974,484** (12.37 MiB).
- Largest subset: **134,544** bytes (131.4 KiB).
- Generated CSS: **70,028** bytes.
- OFL license: **6,027** bytes.

The body font must not replace KaTeX's native math families or the code font.

## Preloaded interface subset

`ui.woff2` adds one **55,404-byte** (54.1 KiB) face containing **212**
codepoints: printable ASCII and the non-ASCII characters in the fixed header,
mobile menu, footer, language/theme controls, and search dialog/interface.
`src/styles/wenkai-ui.css` exposes the CSS alias `LXGW WenKai Screen UI` with the
same unmodified Screen Medium outlines and original internal name/license
metadata. Text outside this small face falls back to the complete body subsets.

The layout preloads this same-origin file. UI-only `font-display: block` avoids
briefly showing fallback letters before the preloaded face is ready; the full
article face retains `font-display: swap`. This reduces font requests for the
fixed controls without adding a new font or changing code/math families. It
cannot eliminate network latency on a cold connection.

Regenerate when the listed components' UI text changes (both the full command
above and this smaller command generate the interface subset):

```bash
uv run --offline --with fonttools==4.67.0 --with brotli==1.2.0 python scripts/build-wenkai.py --ui-only /tmp/LXGWWenKaiScreen-v1.530.ttf
```

`--ui-only` leaves all 188 complete body subsets and their CSS untouched. The
source SHA-256, source family/weight, exact generated cmap and variation mappings
are checked identically to the body subsets; the normal Astro build needs none
of these generation tools or the source TTF.
