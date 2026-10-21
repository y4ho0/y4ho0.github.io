# y4ho0's Garden

A static personal digital garden built with Astro, TypeScript, Markdown, native CSS, and native browser APIs.

The site intentionally starts with empty content collections. It does not fabricate courses, notes, labs, projects, essays, personal history, progress, or skill ratings.

## Local development

Use Node.js 24 and npm.

```bash
npm ci
npm run dev
npm run check
npm run build
```

The production build is written to `dist/`. Pagefind indexing, content validation, quote generation, and output validation are part of the completed build pipeline.

## Content

Content lives in Astro Content Collections under `src/content/`:

- `courses`
- `notes`
- `labs`
- `projects`
- `essays`

Draft entries are validated but excluded from production routes, feeds, sitemaps, archives, and search.

Browser-based article management is available at `/admin/`. See [后台使用与认证配置](ADMIN_GUIDE.md) for local drafts, GitHub publishing, editor layouts, security limits, and validation steps.

Notes, labs, projects, and essays may opt into the homepage post-location map. The `region` key groups entries at the same place, so its name and coordinates must remain consistent:

```yaml
location:
  region: hangzhou
  name: Hangzhou
  latitude: 30.2741
  longitude: 120.1551
```

Marker size is calculated from the number of published, non-draft entries at each region. Omitting `location` keeps an entry off the map.

Math uses standard `$inline$` and `$$display$$` syntax. Semantic blocks use Markdown container directives, for example:

```markdown
:::theorem{title="Optional title"}
The statement goes here.
:::

:::proof
The argument goes here.
:::
```

Supported block names are `theorem`, `proof`, `definition`, `lemma`, `proposition`, `corollary`, `remark`, and `example`.

## Privacy

The public site avoids personal identity, education, residence, contact, résumé, employment, competition, research, internship, and skill-rating information. Optional post-location metadata represents only an explicitly chosen publication location; it must not be used to infer or publish a home address. The About page documents only the site itself.

## Interface language

Public pages default to Simplified Chinese. Use the **中文 / EN** control in the desktop header or mobile menu to switch to English; the preference is saved as `garden-language` in localStorage and applies across pages. The Yahoo wordmark and navigation align to the left; search uses a magnifying-glass icon and retains its keyboard shortcuts. 中文 / EN buttons have equal sizes, and the footer uses LXGW WenKai Screen. Theme controls use monitor / sun / moon icons with translated tooltips and accessible names. Palette changes ease over 720ms with a cubic-bezier curve while controls remain interactive; reduced-motion preferences switch immediately.

Language switching updates interface labels, page titles, descriptions, search messages, and date formatting without reloading the page. Article titles, summaries, Markdown, tags, place names, daily quotes, and friend profiles remain in their original language. URLs, content schemas, RSS and sitemap routes are unchanged. The management interface at `/admin/` continues to use Chinese.

Static output and search indexing use the default Chinese interface plus original article content. The alternate English UI text is excluded from Pagefind so labels are not indexed twice. Search queries make CJK word boundaries explicit so Chinese search also works when Pagefind is first loaded in English mode; this does not translate queries or content. No translation service or runtime dependency is added. Without JavaScript, the public pages remain readable in Chinese.

## Friend links

Friend links appear on `/about/`. Add or update entries in `src/data/friends.ts` using `title`, optional `description`, `avatarUrl`, and `link`. Cards follow the site's typography and light/dark theme.

## Deployment

GitHub Actions builds and deploys the contents of `dist/` to GitHub Pages on pushes to `main`, manual runs, and the daily 00:10 Asia/Shanghai schedule. Pull requests run the same checks without uploading or deploying a production artifact. The workflow does not create automated commits or push generated quote state to Git.

Before the first deployment, change **Settings → Pages → Build and deployment → Source** from the legacy `gh-pages` branch to **GitHub Actions**. This repository intentionally does not change that remote setting itself.

## License

See [LICENSE](LICENSE).
