import { defineConfig } from "astro/config";
import { unified } from "@astrojs/markdown-remark";
import rehypeKatex from "rehype-katex";
import remarkDirective from "remark-directive";
import remarkMath from "remark-math";
import remarkContentBlocks from "./src/plugins/remark-content-blocks.mjs";

export default defineConfig({
  site: "https://y4ho0.github.io",
  output: "static",
  trailingSlash: "always",
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath, remarkDirective, remarkContentBlocks],
      rehypePlugins: [[rehypeKatex, { output: "htmlAndMathml", trust: false, strict: "warn" }]],
    }),
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
      wrap: true,
    },
  },
});
