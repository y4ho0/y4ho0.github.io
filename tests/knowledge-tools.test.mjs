import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import remarkKnowledgeTools from "../src/plugins/remark-knowledge-tools.mjs";

const processor = unified()
  .use(remarkParse).use(remarkDirective).use(remarkKnowledgeTools)
  .use(remarkRehype).use(rehypeStringify);

const render = (source) => String(processor.processSync(source));

test("an inline term becomes a keyboard-focusable, text-only explanation", () => {
  const html = render(':term[RPC]{note="远程过程调用"}');
  assert.match(html, /class="term-note"/u);
  assert.match(html, /tabindex="0"/u);
  assert.match(html, /data-note="远程过程调用"/u);
  assert.match(html, /RPC/u);
});

test("term explanation cannot introduce an HTML element", () => {
  const html = render(':term[X]{note="&#60;img src=x onerror=alert(1)&#62;"}');
  assert.doesNotMatch(html, /<img/u);
  assert.doesNotMatch(html, /term-note/u);
  assert.match(html, /<span>X<\/span>/u);
});

test("a local prototype renders a regular link card, not an iframe", () => {
  const html = render(':::prototype{title="HDFS 写入" href="/demos/hdfs-write/"}\n概念模拟，不连接真实节点。\n:::');
  assert.match(html, /prototype-card/u);
  assert.match(html, /href="\/demos\/hdfs-write\/"/u);
  assert.doesNotMatch(html, /<iframe|<script/u);
});

test("unsafe prototype schemes are rejected", () => {
  const html = render(':::prototype{title="evil" href="javascript:alert(1)"}\n说明\n:::');
  assert.doesNotMatch(html, /prototype-card|href="javascript:/u);
});

test("unrelated directives are left to existing Markdown plugins", () => {
  const html = render('普通文本');
  assert.match(html, /普通文本/u);
});
