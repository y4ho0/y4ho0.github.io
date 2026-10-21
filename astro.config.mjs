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
  // Pages serves public assets with CORS enabled. Match that for opaque preview
  // frames locally so self-hosted body fonts load without allowing frame scripts.
  server: { headers: { "Access-Control-Allow-Origin": "*" } },
  // Admin's strict CSP permits self-hosted scripts, never automatic inline JS.
  vite: { build: { assetsInlineLimit: (filePath) => filePath.endsWith(".js") ? false : undefined } },
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
