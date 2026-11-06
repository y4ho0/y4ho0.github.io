let segmenter: Intl.Segmenter | undefined;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** The content index is shared by both interface languages. Pagefind decides
 * segmentation from the first html.lang it sees, so make CJK word boundaries
 * explicit without rewriting the user's input or query punctuation. */
export function searchQuery(query: string): string {
  if (!cjk.test(query) || typeof Intl.Segmenter !== "function") return query;
  segmenter ??= new Intl.Segmenter("zh-CN", { granularity: "word" });
  let previous: Intl.SegmentData | undefined;
  let result = "";
  for (const part of segmenter.segment(query)) {
    if (previous?.isWordLike && part.isWordLike && (cjk.test(previous.segment) || cjk.test(part.segment))) result += " ";
    result += part.segment;
    previous = part;
  }
  return result;
}
