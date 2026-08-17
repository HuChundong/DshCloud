# AGENTS.md

[English](AGENTS.md) | 中文

在这个仓库里怎么干活。每一条规则的存在都是因为违反它付出过代价；
[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md) 里有账单。

## DSH 是依赖，而且必须一直是

**永远不要给 harness 打补丁、vendor 它、或者 fork 它。** 它从 npm 来，版本由 `Dockerfile`
里的 `DSH_VERSION` 钉住，租户运行的就是 registry 发布的那个 `lib/bin.js`。一个只有在被改过的
harness 上才成立的改动，不是这个项目能交付的改动。

升级 = 改版本号 + 重新构建 + 跑验收，顺序如此，而且验收不是可选项。本项目依赖的那些 harness
接口（`window.__DSH_BOOT__`、`/plugins`、被钉死在环回的配置方法）都不是有版本承诺的 API，
所以一次升级只有在验收通过之后才算已知可用。

如果 harness 确实做不到需要的事，答案是给上游提 issue、并在这里记一条已知限制——而不是用一个
补丁层悄悄分叉。

## 加给 DSH 的一切都是 cordis 插件

现在有两个插件：`dsh-gateway-tunnel` 把沙箱的 `/api` 流量送到网关，`dsh-gateway-logout`
提供退出登录控件。第三个也应该长在它们旁边，而不是长进 harness 里。

四条规则，每一条都真的坏过：

- **按包名引用插件，绝不按路径。** `cordis.patch.yml` 用包名指代插件。客户端模块注册表从配置树
  的 baseUrl 解析插件的 `package.json`，且只扫描它能按名字解析到的包——按路径加载的插件只会挂载
  host 那一半，**完全不贡献 client 半边**，而且不报错。
- **装进 profile，不要装进 `/app`。** Node 解析插件自身的依赖，是从插件所在位置往上走的，
  那条路径永远到不了 `/app/node_modules`。
- **用 `--install-links`。** `npm install <本地路径>` 会建软链指回源码位置，Node 于是从软链
  指向的地方解析插件的依赖，而不是从 profile。
- **只依赖同级。** 一个插件对 `packages/` 里另一个包的依赖写成 `file:../<name>`。更深的相对
  路径只有在每一次镜像拷贝都精确复现目录深度时才成立——而确实有一次没有。

这四条**都不会让构建失败**，它们全都在第一次 `import` 时失败。`scripts/check-images.sh`
存在的意义就是抓这个。

## 目录是有含义的

```
Dockerfile              三个镜像，共用一次 npm install
gateway/  web/  sandbox/    一个目录对应一个镜像
packages/               本仓库拥有的 npm 包
integrations/           独立存在，抽走不需要改这里一行
verify/                 验收套件——需要一套真实部署
scripts/                仓库门禁——只需要代码树或构建出的镜像
docs/                   设计说明与踩坑记录，默认英文
```

listing 里看不出来的那几条规则：

- **`integrations/` 不 import 本仓库的任何东西。** 放在那里的东西只跟它所对接的平台说话，
  因此可以整个搬到自己的仓库而不改一行。`cube-volume-juicefs` 是一个 CubeSandbox
  VolumePlugin：它知道 CubeSandbox 和 JuiceFS，对 DshCloud 一无所知。如果 `integrations/`
  里的东西需要伸手进这个项目，那它就不是 integration，该放到别处去。
- **`packages/` 装包，且以自己命名。** 目录名就是包名——因为 `cordis.patch.yml` 引用的是包名，
  读的人不该还要在两套名字之间做映射。
- **`gateway/` 不携带任何 harness 代码。** 它认证每一个租户，并持有等同于宿主 root 的 Docker
  socket。往里加 `@deepseek-ai/*` 等于把租户的运行时放进那个唯一不能运行租户代码的进程；
  CI 会断言它不存在。
- **`scripts/` 不需要部署，`verify/` 可能需要。** 凭代码树或构建出的镜像就能判定的检查放
  `scripts/`，在 CI 里跑。需要真实部署、CubeSandbox 安装或真实模型 token 的检查放 `verify/`，
  对着一套部署跑。

## 推送前该跑什么

CI 会跑前三个。改动触及哪一块就在本地跑哪一个，而不是每次全跑：

```sh
npx oxlint                     # JavaScript
node scripts/check-docs.mjs    # 链接、中英配对、章节对齐
scripts/check-images.sh        # 构建之后：什么能解析、什么能加载
```

**行为改动需要跑验收套件，对着真实部署：**

```sh
cd verify && SANDBOX_RUNTIME=cube COMPOSE_FILE=../compose.yml:../compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh
```

它只以被显式告知的地址登录，不会自己找。`VERIFY_ADMIN` 指定用于控制台检查的管理员，且必须
已经在 `GATEWAY_ADMINS` 里；不设它，那一项检查就跳过。**绝不要指向任何真人的地址**——
验收套件直接从数据库里读验证码，指过去就等于以那个人的身份登录，并在其名下留下会话。

它会消耗真实模型 token，并删除所有沙箱，所以只该在你愿意打扰的那套部署上跑。CI 跑不了它——
这恰恰说明：**CI 绿了并不能证明一个行为改动是对的。**

改了 sandbox 镜像还意味着要建新的 CubeSandbox 模板——模板是创建那一刻拍下的快照，把已有模板
指向新镜像，每个沙箱还原的仍是旧快照。见 [README](README.zh.md) 的「在 CubeSandbox 上运行」。

## 文档

每一页都是一对：英文 `X.md` 与中文 `X.zh.md`，互相链接，`##` 章节相同且顺序一致。英文是默认
入口，也是读者首先落地的那一份。以上全部由 `scripts/check-docs.mjs` 强制执行。

写当下为真的东西。比代码活得更久的推理放
[docs/design.zh.md](docs/design.zh.md)；花掉过排查时间的故障放
[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md)，**并且连同正确结论之前那个错误
结论一起写**——那才是读者无法从代码里重建出来的部分。

宁可给测量值，不要给形容词。「每次小文件创建 38ms，本地盘是 0.06ms」能挺过一次重写，「慢」不能。

## 密钥

`.env.example` 是这个家族里唯一进入代码树的成员；`.gitignore` 覆盖 `.env` 与 `.env.*`，
CI 会在发现被跟踪的环境文件、或任何长得像凭据的东西时失败。每套 CubeEgress 安装都会生成自己的
根 CA，所以 `sandbox/egress-ca/*.crt` 被 gitignore，由运维自行放入。

模型密钥归部署所有，且只在 CubeSandbox 下抵达沙箱——由 CubeEgress 在传输途中替换进去。任何时候
都不该把它写进沙箱的环境、日志行或会话事件。
