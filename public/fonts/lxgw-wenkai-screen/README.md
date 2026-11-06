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
- Generated CSS: **70,216** bytes.
- OFL license: **6,027** bytes.

The body font must not replace KaTeX's native math families or the code font.

## Preloaded interface subset

`ui-27521c70c5fc.woff2` adds one **177,324-byte** (173.2 KiB) face containing
**878** codepoints: printable ASCII, available Latin-1/Extended-A glyphs,
and non-ASCII characters in fixed public/admin interface sources. The generator
scans `src/pages/**/*.astro`, `src/components/**/*.astro`, `src/admin/*.ts`, and
the two `src/{lib,scripts}/ui-language.ts` modules. It deliberately excludes
article content and changing quote data/history. Any requested fixed character
absent from the pinned source font causes generation to fail.
`src/styles/wenkai-ui.css` exposes the CSS alias `LXGW WenKai Screen UI` with the
same unmodified Screen Medium outlines and original internal name/license
metadata. This face comes first in both the body and interface font stacks;
text outside its coverage uses the complete body subsets.

Public pages and `/admin/` preload the same-origin file described in
`src/data/wenkai-ui-font.json`; CSS and preload URLs must match. The filename
contains the first 12 SHA-256 characters of the generated binary so an older
cached font cannot be mistaken for expanded coverage. The original `ui.woff2`
remains available for legacy cached CSS; obsolete hashed faces are removed when
regenerating.

Both critical and complete body faces use `font-display: block`: text waits
briefly for the correct glyphs rather than immediately painting a fallback font.
This is the browser's bounded block period (typically about 3 seconds), not a
JavaScript page-visibility gate. A failed or unusually slow request still falls
back so the page remains readable and controls remain usable. A later successful
font load can still replace that fallback after the bounded period. Preloading
the shared critical face reduces normal cold-load delays, while fonts already
in the browser cache can render immediately. Code and KaTeX keep their own fonts.

Regenerate when the listed interface sources change (both the full command
above and this smaller command generate the critical subset and its manifest):

```bash
uv run --offline --with fonttools==4.67.0 --with brotli==1.2.0 python scripts/build-wenkai.py --ui-only /tmp/LXGWWenKaiScreen-v1.530.ttf
```

`--ui-only` leaves all 188 complete body subsets and their CSS untouched. The
source SHA-256, source family/weight, exact generated cmap and variation mappings
are checked identically to the body subsets; the normal Astro build needs none
of these generation tools or the source TTF.
