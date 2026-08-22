# 内置依赖

[English](README.md) | 中文

只有一个文件，原因也只有一个：`@cubesandbox/sdk` **没有发布到 npm**。这个包是存在的
——0.3.0 版，在 CubeSandbox 仓库的 `sdk/node/` 下，有 `dist`，也有
`prepublishOnly` 脚本——但 `npm view @cubesandbox/sdk` 返回 404，按名字依赖不到它。

另一条路是继续自己写客户端，那正是这套部署此前在做的事，也正是 `AGENTS.zh.md` 里明令
禁止的事。把一个构建产物放进代码树，是两害中较轻的那个：它只有一个文件，一眼就能看出是
生成的，而且上游一发包它就可以消失。

## 怎么重新构建

```sh
git -C ../CubeSandbox fetch && git -C ../CubeSandbox merge --ff-only origin/master
cd ../CubeSandbox/sdk/node && npm install && npm run build
npm pack --pack-destination ../../../DshCloud/vendor
```

然后把 `gateway/package.json` 指到新版本。

| 包 | 版本 | 构建自 |
| --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | TencentCloud/CubeSandbox `981ccda4` |
