# 右侧面板 —— 交接文档

> 设计详见 [`artifact-panel.zh.md`](./artifact-panel.zh.md)。本文是给接手开发的人看的：现在到哪一步、什么已经定了不用再议、什么还等着定、从哪一行代码开始。

## 当前状态

**M2 的纯 UI 外壳正在本地开发中**，`gateway/src/` 未改动，数据面一行未写。面板里所有内容都是占位的——这一阶段的目的只是让人先确认界面形态对不对，任何"它好像没反应"都是预期。

## 一句话产品定义

右侧只放两种东西：用户主动开的工具（文件 / 终端 / 浏览器），和 agent 被动产出的结果（文件预览）。两类都不是的东西不进这个面板——这条判据是拒绝功能蔓延的唯一依据，请优先维护它。

## 已定，不必重议

| 决定 | 要点 |
|---|---|
| 数据平面走 envd | 不走隧道。因此**插件没有 host 半**，是纯浏览器包；envd 调用全在 `gateway/src/envd.js` |
| 面板挂载方式 | body 级 portal（整面板 slot 被 `ui-layout` 独占，拿不到） |
| 被动 = 列出可点 | 不自动弹出、不抢焦点、不需要"钉住"状态机 |
| 被动不用自己算产出 | `ui-deliverables` 已渲染产出 chip 行，包一层 `workspaces.openPath` 即可接管；**接管不了要放行原方法**，别吞掉 |
| 所有 tab 可开可关 | 包括文件树。主动/被动是判据，不是 tab 行为差异 |
| HTML 预览同源 + CSP | 不需要独立 origin/子域名 |
| viewer 内部注册表 | 不对外开放服务，不做生态底座 |
| 面板几何存哪 | 插件自有设置 + `<html>` 上的布局变量；首屏读偏好要带超时兜底，读不到就用默认值照常挂载 |

## 待定 —— 开工前需要拍板

1. **文件只读还是可编辑。** 只读则 envd 只用 `GET /files`；可写要加 `POST /files` multipart，并处理 agent 同时在写的覆盖问题（建议用 `Stat` 的 `modified_time` 作弱 ETag：打开时记录，保存前复查，变了就提示而非盲写）。
2. **要不要引入构建步骤。** 现有约定是客户端模块逐字提供、零构建，`client.js` 只能手写 `React.createElement`。倾向先不引入，超过约 1500 行再评估。
3. **浏览器 tab 浏览什么。** "看 agent 起的 dev server"（CubeProxy 端口虚拟主机，现成）还是"上外网"（出口代理、凭据、安全边界，工作量差一个数量级）。这条可以晚定，在 M6。

## 阻塞项

**已解除。** 原文写的是"`chat.tempvm.com` 已下线"，不成立——部署活着，在 `chat.tempvm.com:8443`（注意端口）。

M8/M9 要的也不是截图。这部分的硬要求是"结构化选择器，不吃哈希类名"，凭图猜 DOM 本来就是次优解：直接从活部署把标题栏那块的真实 DOM 拉下来写选择器，再验证未命中时的降级。唯一需要的是有人把一个**进行中的会话**开着。

仍然成立的那半句：这部分是在不属于我们的组件上做 DOM 手术，凭描述猜结构最容易把界面弄破相。**其余里程碑不受此影响。**

## 已核实的平台事实（省去重新考据）

这些都实地验证过，可直接使用：

**dsh 侧**

- `ctx.workspaces.openPath` 是对话里所有文件打开的唯一汇聚点（工具行路径链接、产出 chip、正文文件提及都经 `ui-conversation` 解析成绝对路径后调它），默认交给宿主 OS —— 在沙箱里等于无反应。包装时**必须存原始引用而非 bound 副本**，否则多插件包同一方法时卸载顺序一乱就断链。
- `ui-deliverables` 在每轮末尾渲染产出文件 chip 行。其产出判定：`tool-result` 节点的 `callView` 满足 `card === 'diff'` 或 `card === 'generic' && kind === 'edit'` 才算，读取/删除/失败不算；轮边界重置。盲区：经 shell 重定向产出的文件（如 `python gen.py > out.html`）不计入。
- 整面板 slot 由 `ui-layout` 独占。已知可用 slot：`conversation.input.dock`、`conversation.input.overlay`、`sidebar.footer.action`、`settings.section`、`settings.action`、`tool.call.toolview`。slot 引擎支持 `single`/`keyed`/`list` 三种基数，条目可用 `children` 声明子 slot。
- 皮肤令牌：面板表面用 `--dsw-alias-bg-layer-1`；**绝不用 `--dsw-specific-sidebar-fill`**（宿主左导航专属，有皮肤设为 `transparent`）。文本表面读到 alpha < 0.9 的半透明值要回退不透明底色。
- z-index：DSH 浮层在 100 / 1000+，面板取 40 一档即可被浮层正确覆盖。
- 存在 `dsh-web-ui` 家族的 `aionui-panel` 右面板提供方，它被选中时我们必须整个不挂载。
- CSS Modules 哈希类名不是契约，精确命中用 `[data-dsh-artifact-panel]` 属性选择器。
- i18n 跟随 `ctx.locale`，不是浏览器语言。

**envd 侧**

- Connect 服务 `filesystem.Filesystem`：`ListDir { path, depth }`、`Stat { path }`、`MakeDir`、`Move`、`Remove` 均为 unary；`EntryInfo` 含 `name/type/path/size/mode/permissions/owner/group/modified_time/symlink_target/metadata`，`FileType` 在 `connect+json` 下序列化为 `"FILE_TYPE_FILE"` 等字符串。
- HTTP：`GET /files?path=&username=` 下载，`POST /files?path=` multipart 上传（整文件覆盖，自动建父目录）。鉴权可用 `X-Access-Token`，也支持 `signature` + `signature_expiration` 预签名。
- **`gateway/src/envd.js` 已有全部传输层**：Connect 信封编解码、`Host: 49983-<sandboxId>.<domain>` 的 CubeProxy 寻址、`Authorization: Basic root:`。加 `Stat`/`ListDir` 各约十行。但 `readFile` 要多一步：`envdRequest` 写死了 `method: 'POST'` 且不接受查询串，而取文件走 `GET /files?path=`——得先一般化它，且它是 `startBackend` 唯一的生命线，别顺手重构。
- **`decodeEnvelopes` 不能用于流式调用**：它在 `response.on('end')` 后一次性解析完整 body，长连接会阻塞到超时。控制台（PTY）需要另加一条流式路径。
- 网关侧 `callerOf(req)` 解析调用者、`sandboxes.ensure(username, caller.id)` 拿 `sandboxId`，**不经过隧道**（`/sandbox/restart` 是现成范例）。

**两条安全约束（不是可选加固）**

1. **只接受绝对路径。** `ENV HOME=/workspace` 是容器环境变量而非 passwd 中 root 的 home；envd 按 passwd 解析相对路径，`path=notes.md` 会落到 `/root/notes.md`。网关直接拒绝相对路径。
2. **路径钉在 `/workspace` 内——但这是范围，不是防线**（这一条先前写反过）。安全属性只有一条且不在路径处理里：`callerOf` + `sandboxes.ensure` 让请求只能打到调用者自己的沙箱。沙箱内部没什么可防的——租户在自己的沙箱里是 root，agent 就是个 root shell。所以 `/workspace` 的意义是"这是工作区浏览器不是文件系统浏览器"。**软链不追**：早先版本每个请求做一次 `realpath` 再校验，买不到安全性（同样的内容跟 agent 说一句就有），却多一趟往返，而且租户把自己的目录链进工作区本来就该能打开。`/proc/<pid>/environ` 里的部署级 `DEEPSEEK_API_KEY` 确实存在，但租户 `printenv` 就能拿到，先于面板存在。

## 里程碑与完成判据

**被动线**（做完产品即成立）

| # | 内容 | 完成判据 |
|---|---|---|
| M1 | ✅ 已完成 | 经 nginx 能列目录、读文件；相对路径 400、范围外 403、不存在 404；工作区内的软链正常打开 |
| M2 | 面板外壳：body 挂载、`data-dsh-artifact-panel` 锚点、令牌样式、`aionui-panel` 互斥（**要实时重算，不能只在启动时判一次**）、tab 栏、空状态三选项、无会话态右上角开关 | 面板能开关，空状态可见三个选项 |
| M3 | ✅ 已完成 | 三个来源（工具行路径链接、产出 chip、正文文件提及）都汇进面板；面板关着会自己打开；工作区外的路径放行给原方法；实测刷新后 `openPath` 零调用，不抢焦点 |
| M4 | 图片与 HTML viewer：CSP `sandbox` + 路径编码 URL | 带相对资源的 HTML 能正常渲染，且拿不到同源访问 |

**主动线**（互不阻塞）

| # | 内容 | 备注 |
|---|---|---|
| M5 | 文件 tab | `ListDir` 懒加载 |
| M6 | 浏览器 tab | iframe，工作量小，取决于目标定义 |
| M7 | 控制台 tab | `envd.js` 流式路径 + 网关 WebSocket 桥接 + 终端前端。**单独最重，需独立评估** |

**宿主界面线**（最低优先级，被阻塞）

| # | 内容 |
|---|---|
| M8 | 会话中的面板开关（标题栏左侧，与"轨迹"相邻） |
| M9 | "对话/轨迹"并入"标准模式"行；session log 缩小移位 |

M8/M9 的硬要求：结构化选择器不吃哈希类名；**选择器未命中时保持上游原样**（难看但可用），绝不能按钮消失、重叠或错位；每处改造独立开关。

## 从哪开始

M1，只碰两个文件，不涉及任何 dsh 插件代码：

1. `gateway/src/envd.js` —— 照现有 `runCommand` 的写法加 `stat` / `listDir`（unary，比 `runCommand` 的事件流循环更简单），再加一个走 envd HTTP `/files` 的 `readFile`。
2. `gateway/src/panel.js`（新建）—— 路由与路径守卫，在 `server.js` 中 `/api|/files` 分支**之前**挂载（那个分支在 `server.js:510`）。注意别用 `/files` 前缀，那已经是隧道平面的通道。
3. `web/site.inc` —— 加 `location /sandbox/fs/` 与 `/sandbox/raw/`。现有的 `location = /sandbox/restart` 是精确匹配，不覆盖新前缀；漏了这一步，直连网关的 curl 全过，浏览器全 404。

参考实现 `github.com/omdsh-dev/DSH-better-sidebar`（MIT）的 `src/html-route.ts` 有路径编解码的完整实现，`src/fs-tree.ts` 有前缀比较（但**它不做 realpath**，别照抄那一半）。

先写路径守卫并为它写测试，再写路由。这一层错了后面全是洞。
