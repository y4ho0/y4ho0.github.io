import assert from "node:assert/strict";
import test from "node:test";
import { searchQuery } from "../src/lib/search-query.ts";

test("CJK word queries are independent from the selected interface language", () => {
  assert.equal(searchQuery("数字花园"), "数字 花园");
  assert.equal(searchQuery("数学公式"), "数学 公式");
  assert.equal(searchQuery("数字 花园"), "数字 花园");
});

test("mixed English and CJK words have searchable boundaries without changing quoted phrases", () => {
  assert.equal(searchQuery('"数字花园" Astro'), '"数字 花园" Astro');
  assert.equal(searchQuery("Astro数字花园"), "Astro 数字 花园");
  assert.equal(searchQuery("数字花园Astro"), "数字 花园 Astro");
  assert.equal(searchQuery("(数字花园), Astro!"), "(数字 花园), Astro!");
});

test("English, code punctuation, spacing and empty queries are preserved", () => {
  for (const query of ["", "Astro TypeScript", '"exact phrase"', "can't", "foo-bar", "const answer = 42;", "  spaced  query  "]) assert.equal(searchQuery(query), query);
});
