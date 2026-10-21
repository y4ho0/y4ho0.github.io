# 浏览器文章管理后台

后台入口为 [https://y4ho0.github.io/admin/](https://y4ho0.github.io/admin/)。它随本仓库的 GitHub Pages 构建发布，不出现在公开导航、RSS、Sitemap 或 Pagefind 文章索引中。入口地址和后台代码本身公开；知道地址不会获得仓库写权限。

## 仓库审计与方案选择

本次实现保留 Astro 静态输出、现有阅读布局、内容模型和 GitHub Actions 部署方式。审计依据为 `package.json`、`astro.config.mjs`、`src/content.config.ts`、`src/content/`、`src/pages/`、`src/layouts/`、`src/lib/`、`scripts/check-content.mjs` 和 `.github/workflows/deploy.yml`。开始实现时五个内容目录只有 `.gitkeep`，没有需要迁移或修改的文章，也没有统一的文章图片目录。

现有 Markdown 管线支持数学公式、语义块和 Shiki 代码高亮。内容通过集合与 `course` 关系决定 URL，`draft: true` 由发布内容查询过滤。RSS 包含公开的 essays、labs、projects，以及设置 `feed: true` 的 notes；courses 不进入 RSS。现有内容检查还约束 ID、关联、地点一致性和 URL 唯一性。

已评估 Sveltia CMS 的当前官方能力：

- 它支持可调整宽度的双栏、隐藏第二栏后的 Preview 标签，以及布局记忆，不能因为早期功能缺失就认定它不支持两种布局。参见[编辑器文档](https://sveltiacms.app/en/docs/ui/content-editor)。
- 它支持按集合分别配置字段，可以表示本仓库不同集合。参见[集合文档](https://sveltiacms.app/en/docs/collections/entries)。
- 它的 PAT 登录会把令牌存入 localStorage，与本任务要求的仅页面内存保存冲突。参见[GitHub 后端认证说明](https://sveltiacms.app/en/docs/backends/github)和[账户持久化源码](https://github.com/sveltia/sveltia-cms/blob/main/src/lib/services/user/account.svelte.js)。
- 自定义 backend API 目前不受支持，`registerBackend` 是空操作；现有事件扩展面向文章生命周期。参见[后端扩展限制](https://sveltiacms.app/en/docs/backends)和[事件钩子](https://sveltiacms.app/en/docs/api/events)。要改变认证持久化需要维护 fork 或内部补丁。

因此本版采用独立的 TypeScript 编辑界面，复用博客排版样式、数学与语义块插件，直接调用固定目标仓库的 GitHub API。认证、单一编辑状态与本地草稿由后台自身管理。

## 首次配置与登录

1. 先将包含后台的 Pull Request 合并，并等待原有 GitHub Actions 成功部署。开发分支或 PR 检查通过不会自动发布生产后台。
2. 仓库的 **Settings → Pages → Build and deployment → Source** 必须是 **GitHub Actions**。已有正确配置时无需再改；后台不需要服务器、数据库、OAuth 服务或构建环境中的令牌。
3. 在 GitHub 的 **Settings → Developer settings → Personal access tokens → Fine-grained tokens** 新建短期令牌。Resource owner 选 `y4ho0`；Repository access 选 **Only select repositories**，只选择 `y4ho0.github.io`。
4. Repository permissions 只开启 **Contents: Read and write**。Metadata 的只读权限自动附带；无需 Workflows、Pull requests 或其他写权限。令牌所属账号本身也必须具备 `y4ho0/y4ho0.github.io` 的写权限。[GitHub 令牌设置说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
5. 打开 `/admin/`，将令牌粘贴到密码框，点击“连接 GitHub”。成功后加载文章与媒体；无效令牌或不能证明仓库写权限的凭据会被拒绝。
6. 写作结束点击“退出并清除凭据”；必要时到 GitHub 撤销令牌。刷新、关闭页面也会丢失此页面的认证，需要重新连接。

令牌仅存在当前页面的 JavaScript 内存中，不写入 localStorage、sessionStorage、IndexedDB、文章、URL、构建产物或仓库。localStorage 只保存布局、主题、Markdown 快捷键及公开页面语言偏好。每次上传、提交和删除前重新做身份及权限预检，最终仍由 GitHub 对实际写请求执行授权。

权限预检同时要求账号的仓库 push 权限，以及仓库响应中只能在具备 Contents 读写权限时读取的合并设置；缺失时保守拒绝。此检查不能保证分支保护、规则集或后来撤销的权限允许提交。官方依据见[获取仓库](https://docs.github.com/en/rest/repos/repos#get-a-repository)。读取公开文件成功或响应头 `X-Accepted-GitHub-Permissions` 都不能单独证明令牌获得写权限；该响应头表示端点要求的权限，见[GitHub 排错说明](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#resource-not-accessible)。

静态网页无法使令牌免受恶意扩展、设备恶意软件、同源页面漏洞或浏览器开发工具影响。仅在可信设备和可信页面版本使用，不把令牌粘贴进正文、链接或控制台。退出会清除页面持有的凭据并中止本页面的待处理请求；已经到达 GitHub 的请求可能仍已执行，应检查提交历史确认。

## 新建、查找与编辑文章

未登录也可以新建、预览、保存本地草稿和导出 Markdown；仓库读取与写入操作需要连接 GitHub。

1. 点击“新建文章”，填写标题、摘要，展开“文章设置”选择集合并填写文章 ID、标签和日期。ID 使用小写英文、数字及单个短横线，例如 `linear-algebra`，不包含空格、扩展名或子目录。新文件为 `src/content/{集合}/{ID}.md`。文章设置默认折叠以让出写作空间，手机端文章库也默认收起。
2. 在 Markdown 区写正文。文章标题由页面元信息生成，正文通常从 `##` 开始。
3. 根据集合填写课程、RSS、关联与发帖地点。检查下表，不要把所有集合当作同一种模型。
4. 点击“保存本地草稿”保留尚未发布的内容。准备公开时取消“GitHub 未发布文章”勾选，再点击“提交到 GitHub”，阅读确认内容后提交。
5. 连接 GitHub 后，可在文章库按集合筛选或根据标题搜索。列表显示日期及仓库草稿状态。打开已有文章后直接编辑；既有路径、集合、ID 和会影响 URL 的课程关联被锁定。

通用必填字段是 `title`、`description`、`updatedAt`；`publishedAt` 可省略。`tags` 默认空数组，成长状态 `status` 默认 `seedling`，还可选 `growing` 或 `evergreen`，表示文章从初稿到完善、稳定的程度。成长状态与发布状态 `draft` 是不同字段。后台以现有五个集合作为“分类”，不另加或迁移 `category` 字段。

| 集合 | 特有约束 | 公开 URL |
| --- | --- | --- |
| courses | 不支持 `location`，不需要 `course` | `/courses/{ID}/` |
| notes | `course` 可选；`feed` 默认 false | 有课程：`/courses/{course}/notes/{ID}/`；无课程：`/garden/{ID}/` |
| labs | `course` 可选 | 有课程：`/courses/{course}/labs/{ID}/`；无课程：`/labs/{ID}/` |
| projects | 必须关联已存在的 Course | `/courses/{course}/projects/{ID}/` |
| essays | 不需要 `course` | `/essays/{ID}/` |

“关联文章与发帖地点”中的关联使用 JSON 数组，例如 `[{"collection":"notes","entry":"linear-algebra"}]`；地点使用 JSON 对象，例如 `{"region":"hangzhou","name":"Hangzhou","latitude":30.2741,"longitude":120.1551}`。关联目标必须存在，公开子文章不能关联仍为草稿的 Course。同一 `region` 的名称与坐标必须一致，包括仓库草稿。

编辑会保留已有但表单未呈现的 frontmatter 数据字段；YAML 会重新序列化，因此注释、引号选择、空行及字段顺序可能变化。危险键、未知 YAML 标签、重复键、循环引用与无法验证的数据会显示错误并阻止提交。迁移路径、重命名或更改已有课程归属请通过正常 Git 工作流处理，并检查所有引用及旧 URL。

删除已有文章必须二次确认。若其他条目的 `course` 或 `related` 仍引用它，后台阻止删除并列出引用；应先修改引用并提交。草稿中的引用也参与检查。后台不会级联删除其他文章。

## 两种写作布局

宽屏默认“左右对照”，Markdown 与实时预览并排。拖动中间分隔线调整宽度；聚焦分隔线后也可以使用方向键调整。

右上角点击“切换模式”后，使用“编辑”和“预览”标签显示完整宽度的相应区域。两种布局始终共享同一个正文 textarea 和文章状态；切换只改变显示方式，保留未保存内容、光标、选区和编辑滚动位置，不新建第二份编辑器。

窄屏自动使用切换布局。恢复宽屏后会尽可能恢复之前选择；布局偏好保存于 localStorage，认证信息不会随之保存。

顶部主题控件用显示器 / 太阳 / 月亮图标分别表示“跟随系统 / 浅色 / 深色”，与主页共用设置和 `garden-theme` 偏好，悬停及无障碍名称保留对应说明，切换或刷新后保持一致。后台界面、下拉菜单及实时预览都同步主题，代码使用对应的浅/深色高亮；主题只在根元素上对已注册的颜色变量做一次渐变，内部文字直接继承，避免父子元素各自过渡后在结束时二次跳色；不支持 CSS 注册属性的旧浏览器直接换色。主题颜色以 720ms、`cubic-bezier(0.4, 0, 0.2, 1)` 曲线缓动，仍可连续点击和写作；遵循系统减少动态效果偏好。主题切换不重新创建编辑器或预览，不改变选区和滚动位置。选中高亮直接依据页面 head 已初始化的 `data-theme-preference`，避免导航时先高亮静态 System 默认值、再由延后脚本纠正；语言控件采用同样策略。发布状态选项保持整行，空间不足时 RSS 选项整体移到下一行。

## Markdown 工具与快捷键

编辑区上方提供二级至六级标题、加粗、斜体、删除线、引用、有序／无序／任务列表、行内代码、代码块、链接、图片引用、表格、分隔线与行内／独立公式。选中文字后点击工具会格式化选区；没有选区时插入可直接替换的占位文字。行级工具处理当前行或选中的多行，再次点击可取消对应格式。跨段落格式按段落处理，保留空行、邻文和原有换行；代码块会避开内容中的反引号定界符。

**文章题目填写上方“标题”字段**：它写入 frontmatter 的 `title`，由文章页生成一级标题，也用于文章列表、搜索与 RSS。正文中的 `# 标题` 不会同步此字段，还会生成重复一级标题，与现有构建的单一 H1 检查冲突。因此工具只提供 H2–H6，正文通常从 `##` 开始。

工具悬停提示当前快捷键。以下 `Mod` 在 Mac 上是 ⌘，其他系统是 Ctrl：

| 工具 | 默认快捷键 |
| --- | --- |
| 加粗 / 斜体 / 删除线 | Mod+B / Mod+I / Mod+Shift+X |
| 二级至六级标题 | Mod+Alt+2 至 Mod+Alt+6 |
| 引用 | Mod+Alt+Q |
| 有序 / 无序 / 任务列表 | Mod+Shift+7 / Mod+Shift+8 / Mod+Shift+9 |
| 行内代码 / 代码块 | Mod+E / Mod+Shift+E |
| 链接 / 图片引用 | Mod+K / Mod+Alt+Shift+I |
| 表格 / 分隔线 | Mod+Alt+Shift+T / Mod+Alt+Shift+H |
| 行内公式 / 独立公式 | Mod+Alt+Shift+M / Mod+Alt+Shift+B |

快捷键仅在正文编辑器获得焦点时生效，不会修改标题、摘要、认证输入或隔离预览；忽略输入法组合及长按重复事件。组合中的字母、数字按物理键位识别，避免 Shift 数字符号及 Mac Option 变音字符导致无法匹配。系统或浏览器扩展优先接管的按键可能无法传给页面，这时使用工具按钮或改绑。

点击“快捷键”，聚焦对应键位框并按新组合键；退格、Delete 或“清除”禁用该绑定。设置检测重复组合、跨平台 Mod 冲突及常见浏览器／系统保留键；复制、剪切、粘贴、选择、撤销／重做等原生操作保留。“恢复默认”只填回默认值，点击“保存快捷键”才应用，“取消”或 Escape 不改变当前绑定。保存到当前浏览器 localStorage，刷新后继续生效；与草稿内容和认证令牌分开。无法写入浏览器存储时显示错误并保留原绑定。

链接工具会选中 URL 供替换；图片按钮只插入同源图片引用模板，不上传、不访问第三方占位图片。真实图片上传仍通过媒体管理确认。代码块首行的反引号后可补 `js`、`ts`、`python` 等语言标记以启用相应高亮。任务列表在预览中以只读勾选符号显示，隔离预览仍不允许表单输入控件。

格式插入优先使用浏览器原生编辑命令保留撤销历史，已在 Chromium 验证格式操作后可以原生撤销／重做；不支持时回退 `setRangeText`。原生 `execCommand` 属于兼容 API，其降级路径不能保证保留浏览器撤销历史，其他浏览器需实测；采用此兼容路径的原因见 [MDN 的撤销历史说明](https://developer.mozilla.org/en-US/docs/Web/API/Document/execCommand)。默认组合避开 macOS 的窗口隐藏与最小化等系统键，依据见 [Apple 键盘快捷键](https://support.apple.com/en-us/102650)。

## 本地草稿、仓库草稿与公开发布

| 状态 | 保存位置 | 是否公开 | 是否执行 GitHub 提交 |
| --- | --- | --- | --- |
| 本地草稿 | 当前浏览器 IndexedDB | 不会因保存而上传；同设备、同源脚本仍可读取 | 否 |
| GitHub 未发布文章 | 公开仓库中 `draft: true` 的 Markdown | **源码及历史公开**，只是博客不生成公开文章路由 | 是 |
| 公开文章 | 公开仓库中 `draft: false` 的 Markdown | 源码公开；网站在部署成功后更新 | 是 |

写作时自动保存本地草稿，也可点击“保存本地草稿”。刷新后在左侧“本地草稿”列表恢复；恢复不要求重新输入令牌，恢复后的仓库提交需要重新登录。草稿记录包含文件原版本、文章内容、选区和滚动位置，不包含令牌。

本地草稿只属于当前浏览器配置与当前站点 origin，不会跨设备、跨浏览器或在 localhost 与生产域名之间同步。浏览器清理站点数据、隐私模式结束、磁盘空间不足或浏览器存储回收都可能造成丢失。IndexedDB 未加密；共享设备上的其他用户，以及同源恶意脚本，可能读取它。退出认证不会自动删除写作内容；离开共享设备前使用“清空全部本地草稿”，并清理下载文件。重要内容使用“导出 Markdown”另外备份。

## 图片上传与插入

1. 先填写文章 ID，再展开“媒体管理”。
2. 选择文件、把图片拖到媒体区或编辑区，或在编辑区按 **⌘ / Ctrl + V** 粘贴剪贴板图片。支持 PNG、JPEG、GIF、WebP，文件不超过 **5 MiB**；检查 MIME、大小和最终文件签名，拒绝 SVG、AVIF 和其他类型。每次处理一张，多张只取第一张；普通文本粘贴不受影响，不会自动获取粘贴的远程图片 URL。
3. 点击“上传并插入”，确认后上传到 `public/images/{文章ID}/{文件名}`。**图片上传立即产生公开 GitHub 提交，与文章是否发布无关。** 上传后会插入形如 `![图片说明](/images/linear-algebra/diagram.png)` 的 Markdown，可继续修改替代文字。
4. 也可从“已上传图片”选择已有图片并插入，不需要重复上传。重名不会静默覆盖已有文件；发生冲突应换文件名。

图片提交也会触发原有 Actions。站内图片 URL 在该次部署完成前可能尚不可访问；文章尚未发布也不会让已经提交的图片变成私有。本版不提供媒体删除和替换，避免破坏已有引用；需要清理时在仓库中检查所有引用后通过 Git 处理。

拖拽、粘贴和选择文件只会先显示本地缩略图、文件名和大小；点击“上传并插入”并确认后才发送图片。未登录可以暂存图片，但上传必须先连接 GitHub 并填写有效文章 ID。待上传图片只在当前页面内存中，刷新后需要重新选择，不随 IndexedDB 文字草稿保存；退出会清除所选图片。

## 并发冲突、请求失败与部署

打开文章时记录 GitHub 文件 SHA。更新或删除前重新读取版本，并把原 SHA 交给 Contents API；发现其他设备或 GitHub 网页端已修改，就停止提交，保留当前编辑内容。新建同名文件也会被拒绝，不能依靠重复点击覆盖。

遇到冲突时：

1. 先“保存本地草稿”并“导出 Markdown”，保留自己的版本。
2. 刷新仓库，重新打开最新文章，比较最新正文与导出的本地版本。
3. 在最新文章上手动合并需要保留的修改，再提交。旧本地草稿可继续保留作参考；恢复旧草稿不会自动获得覆盖新版本的权限。

网络、权限、限额或 GitHub API 失败会显示错误，不会报告提交成功。若请求可能已经发送，但响应丢失，应先检查仓库提交历史再重试，避免误判。分支保护若要求 PR，后台直写 main 会失败；本版不绕过仓库规则，也不自动建立文章 PR。

“提交成功”只代表 GitHub 返回实际提交记录，点击“查看提交”可核对 Markdown。它不代表站点部署完成。点击“检查部署”检查该提交对应的 `deploy.yml` 运行和 **Deploy to GitHub Pages** 作业；只有明确成功才报告部署成功。状态未出现、构建失败、检查受限或响应不可用时，应打开提供的 Actions 链接确认。

部署查询使用公开 Actions 只读接口，不要求给文章令牌额外增加 Actions 权限；读接口受限时降级为链接和未知状态。保持最小 Contents 权限即可使用文章管理。main 提交继续沿用原有 Actions 的校验、构建、索引与 Pages 部署；开发分支 PR 运行检查，不部署生产。

## 预览能力与差异

预览支持标题、强调、列表、引用、GFM 表格、链接、图片、行内代码、围栏代码块及 `$...$` / `$$...$$` 数学公式。复用博客 `tokens.css`、`prose.css`、KaTeX 配置和语义块插件，支持 theorem、proof、definition、lemma、proposition、corollary、remark、example。

全站主要文字和后台预览默认使用自托管的 **LXGW WenKai Screen v1.530（霞鹜文楷屏幕阅读版）**。官方以原版 Medium 的笔画粗度制作 Screen，但内部字重映射为 Regular / 400；没有对其另作假 Medium 加粗。字体由官方 TTF 生成 188 个 WOFF2 分片，按 `unicode-range` 加载所需字符，无需运行时 CDN。完整授权、来源校验和再生成命令见 `public/fonts/lxgw-wenkai-screen/README.md`，正常构建无需 Python 或字体生成工具。

普通正文、标题、加粗、斜体、列表、表格、链接和引用使用文楷；后台页面标题、标签、输入框、按钮和下拉选项也统一使用文楷。Markdown 源码编辑器、行内代码、代码块、`kbd`、`samp` 明确使用等宽字体；公式保留 KaTeX 自带数学字体，避免正文规则覆盖公式字形度量。公开博客页头、导航、语言控件与页脚也使用同源文楷，字号分别为 Yahoo 18.4px、导航 16px、语言与页脚 15.2px（默认根字号下）。额外预加载 54.1 KiB、209 字符的界面子集；正文完整分片及代码、数学字体保持各自用途。栏目页直接以栏目名作为唯一 H1（默认根字号下 32–52px），删除重复口号及无用说明；名言正文与作者均为文楷，作者提高到 16px，标签、面包屑和文章信息等辅助文字提高到约 14–15.2px。下拉框保留原生键盘和表单行为，在支持可定制选择器的浏览器中显示统一圆角菜单；旧浏览器回退系统弹出菜单。浏览器测试同时检查字体加载状态与 Chromium 实际使用的字形来源，覆盖分式、矩阵、上下标和语法高亮。KaTeX 渲染器、CSS 和字体统一为 0.19.0，预览中的数学字体内嵌以避免隔离 iframe 的跨域字体回退。

原始 HTML 在预览 Markdown 转换中禁用；生成的 HTML 再由 DOMPurify 净化，并在没有脚本权限的 sandbox iframe 内展示。公式使用 `trust: false`。不要把输入任意 HTML 后预览没有执行，理解成最终博客接受任意 HTML 都安全：公开构建仍采用仓库已有 Astro 管线，只发布可信 Markdown。

后台代码高亮采用 highlight.js（通过 rehype-highlight），生产构建采用 Shiki 的 github-light / github-dark。可识别语言、token 分类、配色和换行效果可能不同；未知语言在预览中作为普通代码展示。预览固定为写作视图，不包含最终文章外框、目录交互、SEO、阅读进度或代码复制按钮。目录锚点、图片资源部署时机等也可能影响最终效果；生产构建结果为准。

后台新建 `.md`。现有 `.mdx` 文件可按原路径作为文本处理，但预览不执行 MDX 的 import、JSX 或组件，也不提供 MDX 运行环境；当前仓库未配置 MDX 集成。需要这些功能时，先通过独立开发与完整构建验证支持，不能凭后台预览判断可发布。

## 依赖与安全审计

已运行兼容当前版本范围的 `npm audit fix`，并统一升级 KaTeX 以修复其原有告警，没有使用 `--force` 强制升级 Astro 或改变博客架构。修复后审计仍报告 **7 个受影响依赖项：1 critical、1 high、4 moderate、1 low**；它们属于本仓库原有依赖链。后台新增的直接运行依赖未被该次审计标记。此结果不表示依赖或应用不存在其他漏洞，后续应继续跟踪公告并复查。

剩余 Astro / Sharp 相关结果需要主版本升级才能按审计建议完整消除，应作为独立升级任务验证；本仓库未调用 `astro:assets` 图片处理，后台也不接受 AVIF 上传，以减少相关处理路径的暴露。后台以禁用原始 HTML、`trust: false`、DOMPurify 净化及禁止脚本的 sandbox iframe 限制预览输出；这些措施不能替代后续依赖修复与重新测试。最终博客仍只应发布可信内容，不能把预览隔离当成对所有构建路径的安全保证。

## 开发验证与已知范围

使用 Node.js 24 和锁定依赖。验证命令：

```bash
npm ci
npm test
npm run check
npm run build
npx playwright install chromium
npm run test:browser
```

`npm run build` 包含每日引言生成、Astro 生产构建、Pagefind 索引和产物内部链接验证。发布验收应覆盖：未登录、无效令牌、无写权限、新建与编辑、IndexedDB 恢复、提交结果、双栏实时预览、切换后的选区与滚动、手机窄屏、代码和公式、恶意 HTML、API 失败、并发冲突和生产构建。

本次在 Node.js 24 验证：`npm test` 的 97 项测试通过（含临时目录中的真实 Astro 构建、五集合与引用、路由、公式、RSS 和 Sitemap）；`npm run check` 为零错误、零警告，另有兼容 API 弃用提示（原生编辑历史、平台识别及输入法兼容判断）；完整 `npm run build` 通过，包括 Pagefind 和输出验证。浏览器回归 38 项全部通过（后台 23 项，公开界面语言 8 项，主题交互 4 项，导航初始化 3 项），包括工具栏、跨段落格式、原生撤销／重做、自定义快捷键持久化及冲突、Mac Command、实际字体、夜间模式、键盘选择、320px / 390px 控件布局、拖拽和粘贴上传；远端结果见 Pull Request 检查记录。

API 与浏览器测试使用模拟 GitHub 响应覆盖认证、写权限不足、新建、编辑、删除、媒体、失败、SHA 冲突和部署状态，不代表使用真实 fine-grained PAT 写入 main 或线上部署成功。已通过当前开发账号的只读仓库 API 确认权限预检所需字段；真实文章写入与线上部署须分别检查实际提交及 Actions。后台在 PR 合并并成功部署后才上线，最终远端验证结果见该 Pull Request 的检查记录。

本版按单篇 Markdown 提交，不提供富文本编辑、自动合并、MDX 组件运行、跨设备私有草稿同步、媒体清理或服务端会话。它保持现有博客路由和模型；未来改动内容 schema 时，必须同步检查后台校验、表单和测试。
