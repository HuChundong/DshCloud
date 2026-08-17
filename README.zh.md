![DshCloud — Multi-Tenant Cloud for DSH](docs/assets/dshcloud-banner.png)

# DshCloud

[English](README.md) | 中文

项目介绍：[微信公众号文章](https://mp.weixin.qq.com/s/lDd3rK6syoCB7TANxwCRsQ)

> [!IMPORTANT]
> **独立项目声明：** DshCloud 是独立开发维护的非官方项目。**DshCloud 与 DSH
> 不是同一家公司或组织的产品。** 本仓库不隶属于、不代表，也未获得 DeepSeek AI、
> GitHub 上的 `deepseek-ai` 组织、腾讯云、DSH 或 CubeSandbox 维护方的赞助、背书或
> 维护。文中相关名称仅用于说明兼容性和上游依赖；本项目不主张对相关名称、标识或商标
> 享有任何权利。

[DSH](https://github.com/deepseek-ai/deepseek-harness) 的多租户云端部署：一套独立部署的
前端、一个负责认证的网关，以及每位登录用户一个 dsh 后端，各自带一块持久卷。

DSH 本身是依赖，从 npm 安装，从不打补丁。本项目要加给它的东西，一律以 cordis 插件的形式加。

## 截图

### 邀请码注册

![邀请码注册](docs/assets/screenshot-sign-up.png)

### 每租户独立的 DSH 工作区

![每租户独立的 DSH 工作区](docs/assets/screenshot-workspace.png)

### 管理后台

![管理后台](docs/assets/screenshot-admin.png)

## 架构

![DshCloud 架构图](docs/assets/dshcloud-architecture.svg)

四个决策撑起整个设计，其余都由它们推导而来。

**沙箱以出站方式接入。** 租户的后端从不接受连接——它主动拨号连上网关，再经这条 socket 反向
提供 `/api`。于是沙箱不需要入站可达性、不需要发布端口、也不需要改动 dsh 默认的环回绑定；而
隧道上每一个 stream id 都由网关分配，这让「寻址到另一个租户的流」根本无法被表达，而不只是被
禁止。它同时保住了那些被钉死在环回的配置接口——`settings.*`、`credentials.*`、
`agentPreset.*`——因为隧道客户端把每个请求经沙箱自身的环回接口重放。

**网关是唯一的认证边界。** dsh 自身不带认证，而它背后的 agent 以租户的名义、以完全权限执行
shell 命令。`/api` 之下的每一个请求，HTTP 与 WebSocket 一样，都要先解析出会话才可能触达隧道。
签名 JWT 让会话存储不出现在热路径上；而真正让「撤销」成立的，是 Postgres 里那个会轮换的
不透明 refresh token。

**占用模型是一个进程一个租户。** dsh 没有租户概念——它的 `/api` 是单占的，会话存储是进程级
的——所以把两个租户复用进一个后端属于正确性缺陷，而非优化。因此隔离就是机器隔离：CubeSandbox
下是一台微虚机，Docker 模拟下是一个容器。

**模型密钥从不进入沙箱。** CubeSandbox 下沙箱持有的是占位符，由 CubeEgress 在请求出站途中把
真实密钥替换进 `Authorization` 头。沙箱的环境、文件系统、进程表里的任何东西，都可能被提示词
注入读走；而一个从来不在那里的密钥不会。

两道接缝让上述决策保持可移植：

- **运行时接缝。** `cube` 与 `docker` 的区别仅在于机器如何被创建和回收。接缝之上的一切在两者
  之间没有任何变化——恰恰是因为沙箱主动向外拨号，上层任何组件都不需要一条打进去的路由。
- **组合接缝。** DSH 是 npm 依赖，版本钉住且从不打补丁。本项目加给它的东西——隧道、退出登录
  控件——都是从 profile 按包名解析的 cordis 插件。升级 harness 就是改一个版本号，再跑一遍验收。

每一条背后的推理、以及它们取代了什么方案，见 [docs/design.zh.md](docs/design.zh.md)。
一路上踩过什么坑——现象、测量值，以及最先得出的那个错误结论——见
[docs/sandbox-pitfalls.zh.md](docs/sandbox-pitfalls.zh.md)。

## 仓库结构

```
Dockerfile              三个镜像，共用一次 npm install
compose.yml             整套栈，附 CubeSandbox 与正式 TLS 的 overlay

gateway/                网关镜像——会话、账号、路由
web/                    web 镜像——nginx，以及采集出的前端外壳
sandbox/                沙箱镜像——入口，以及 dsh 组合增加与剥离了什么

packages/               本仓库拥有的 npm 包
  tunnel-protocol/        隧道两端共用的帧协议
  dsh-gateway-tunnel/     cordis 插件：把沙箱的 /api 流量送出去
  dsh-sandbox-host/       cordis 插件：后端在另一台机器上时浏览器需要的东西——
                          上传，以及配置文件被读出来而不是被打开
  dsh-tenant-account/     cordis 插件：谁登录着，以及怎么退出

integrations/           独立存在，抽走不需要改这里一行
  cube-volume-juicefs/    基于 JuiceFS over S3 的 CubeSandbox VolumePlugin

verify/                 验收套件——需要一套真实部署
scripts/                仓库门禁——只需要代码树或构建出的镜像
```

[AGENTS.zh.md](AGENTS.zh.md) 是开发约定：DSH 保持为不打补丁的依赖，加给它的一切都是
cordis 插件，上面每个目录只收该收的东西。

`SANDBOX_RUNTIME` 选择运行时：`cube` 是
[CubeSandbox](https://github.com/TencentCloud/CubeSandbox)，每个租户拿到一台微虚机；
`docker` 是一台笔记本就能跑的模拟。

## 运行

```sh
cp .env.example .env      # set SESSION_SECRET, RESEND_API_KEY, GATEWAY_ADMINS, DEEPSEEK_API_KEY
docker compose --profile build build
docker compose up -d
open http://localhost:8080
```

沙箱镜像只构建、绝不由 compose 启动：网关通过 Docker Engine API 为每个租户启动一个。
要换 DSH 版本就改 `Dockerfile` 里的 `DSH_VERSION` 并重新构建——
`docker compose --profile build build sandbox`——已有沙箱会在被回收并重建时用上新镜像。

登录后的首个请求要等待该租户的容器启动并等 dsh 完成引导，因此明显慢于其后的请求。

## 在 CubeSandbox 上运行

```sh
docker compose -f compose.yml -f compose.cube.yml --profile build build

# 沙箱镜像要通过 CubeSandbox 拉得到的 registry 抵达它，而不是本地 Docker 守护进程。
docker tag dsh-sandbox:latest 127.0.0.1:5000/dsh-sandbox:$TAG
docker push 127.0.0.1:5000/dsh-sandbox:$TAG

# 每次都建新模板，而不是更新旧的：模板是创建那一刻拍下的快照，把已有模板指向新镜像，
# 每个沙箱还原的仍是它原来那份快照。把 CUBE_TEMPLATE_ID 指向别名。
cubemastercli template create-from-image \
  --image 127.0.0.1:5000/dsh-sandbox:$TAG --alias dsh-sandbox-$TAG \
  --writable-layer-size 20Gi --cpu 2000 --memory 4000

docker compose -f compose.yml -f compose.cube.yml up -d
```

这层 overlay 指明 CubeSandbox API、CubeProxy 节点，以及一个位于宿主地址上的
`GATEWAY_TUNNEL_URL`——沙箱是 Cube 网络上的一台机器，拨不到 compose 的服务名。

**模板是通用的。** 它是镜像**运行中**状态的快照，为每个租户还原一次，所以镜像启动的任何东西
都会被冻进去——在任何租户存在之前，且每个沙箱里一模一样。因此镜像不声明 `CMD`，
`cube-entrypoint.sh` 只守着 envd，由网关在拿到身份之后，通过 envd 的进程 API 为每个沙箱
启动那一位租户的后端。

这种启动方式带来两个后果。envd 交给它所启动进程的是一个干净环境而非镜像的环境，所以镜像把自己的
`ENV` 投影到 `/app/sandbox/env.sh`，由 entrypoint 自行 source——否则每一行 `ENV` 都会静默地
不再抵达后端。以及这次调用要经过 CubeProxy，它按一个虚拟的 `<port>-<sandboxID>` 主机名路由，
而本地安装并没有把它放进 DNS，所以要用 `CUBE_PROXY_NODE_IP` 指明拨向哪个节点。

**模型密钥从不进入沙箱。** CubeSandbox 的规则允许 CubeEgress 在请求出站途中改写它，因此沙箱
拿到的是占位符，真实密钥由 CubeEgress 在请求经过时替换进 `Authorization` 头。这一点要紧，是因为
里面的 agent 以租户的名义拥有完全权限：环境里的密钥就是能被提示词读回来的密钥。CubeEgress 靠终止
TLS 做到这件事，所以该安装自己的根 CA 必须在镜像内被信任——它从不入库，因为每套安装都生成自己的一份：

```sh
docker cp cube-egress:/etc/cube/ca/cube-root-ca.crt deploy/sandbox/egress-ca/
```

**网关必须被显式放行。** CubeSandbox 允许公网出站，但同时把私有网段一并拒绝，使沙箱无法借它的
互联网访问去够到运行它的基础设施。网关正落在这些网段之一，所以它的地址会在创建时加入
`allowOut`——见 [`gateway/src/egress.js`](gateway/src/egress.js)。

## 验证

```sh
./verify.sh                                              # the Docker simulation
SANDBOX_RUNTIME=cube COMPOSE_FILE=compose.yml:compose.cube.yml \
  GATEWAY=https://host:8443 ./verify.sh                  # CubeSandbox
```

它让两个租户登录，检查这套部署存在的意义所在：未认证的调用与升级被拒、每个租户拿到各自的
沙箱、后端只监听环回、两条 `/api` 下行都能打开、一次真实模型轮次在真实浏览器里完成，以及
任一租户都无法列出、读取或向另一租户的会话发送提示。随后它删除所有沙箱，检查界面在没有
沙箱时仍能加载。

两个浏览器套件都会消耗真实的模型 token。各套件分别为捕捉什么而存在，见
[docs/design.zh.md](docs/design.zh.md#验证)。

## 已知限制

- **会话能挺过网关重启，沙箱不能。** 因为会话存放在 Postgres 中，重新部署后登录状态仍在，
  但所有沙箱会在启动时被回收。开启 volume 时，租户的文件与历史会随下一个沙箱回来，丢失的
  只是正在进行的那次对话；未开启时，租户面对的是一个空工作区。跨重启接管仍在运行的沙箱是
  下一步，需要把沙箱注册表与会话放在一起。
- **Postgres 并不能让网关变成无状态。** 它移除的是网关的磁盘状态，而不是状态本身：活着的
  隧道是沙箱拨向某一个进程的 WebSocket，因此第二个副本无法服务那些沙箱连到第一个副本的
  租户。多副本网关要解决的是隧道，而不是会话。
- **邀请码是持有即有效的凭据。** 任何拿到未使用码的人都能注册，包括被转发到的那个人。它是
  一次性的，并记录下用掉它的地址——这让事情在事后可见，而不是事前不可能。
- **撤销最多有十五分钟延迟。** access token 是网关只验签、不查库就能确认的 JWT，这正是
  `/api` 不必碰存储的原因；一旦签发，任何东西都收不回来。退出登录、停用与删除都会立刻撤销
  refresh token，账号因此无法续期——但已经在浏览器里的那个 token 会走完它的有效期。
- **Docker 模拟不持久化任何东西。** host mount 是 CubeSandbox 的能力；被回收的容器会一并
  带走其工作区与历史。
- **网关持有 Docker socket**，等价于宿主机 root 权限。这正是网关不运行任何租户代码、
  且不暴露任何认证请求可操控之物（除启动该租户自己的沙箱之外）的原因。在 `cube` 下它只用于
  启动模拟的容器，以及在证书续期后向 nginx 发信号。
- **Docker 模拟无法扣下模型密钥。** 容器前面没有 CubeEgress 把它补回去，所以在 `docker` 下
  密钥就在沙箱的环境里，agent 读得到。它是一套模拟，而这是它不模拟的东西之一。
- **首次构建很慢。** 它要安装约 200 个 npm 包并编译 `node-pty`，后者没有 linux/arm64
  预编译产物。之后的构建会复用该层，除非钉住的 DSH 版本变了。
- **升级 DSH 是一次重新构建。** 版本烘焙在镜像里，所以换用更新的 harness 意味着改版本号、
  重新构建、再跑一遍验收——不是重启。

## 上游项目与致谢

DshCloud 依赖以下上游项目，并感谢其维护者与贡献者：

- [DeepSeek Harness（DSH）](https://github.com/deepseek-ai/deepseek-harness)：本项目作为
  npm 依赖安装的上游 agent harness。DSH 采用 [MIT License](https://github.com/deepseek-ai/deepseek-harness/blob/master/LICENSE)。
- [CubeSandbox](https://github.com/TencentCloud/CubeSandbox)：用于提供每租户隔离能力的
  可选微虚机沙箱运行时。CubeSandbox 主体采用
  [Apache-2.0，并在其许可文件中列出第三方组件许可](https://github.com/TencentCloud/CubeSandbox/blob/master/LICENSE)。

各上游项目仍由其各自的维护者管理，并遵循各自的许可条款。此处致谢不表示任何隶属、
赞助、背书或共同所有关系。
