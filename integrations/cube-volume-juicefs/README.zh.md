# JuiceFS 后端的 volume 插件

[English](README.md) | 中文

一个 CubeSandbox VolumePlugin，为每位租户提供一个持久、受配额约束的目录，其数据存放在 S3 兼容对象
存储中。

## 它为什么存在

沙箱是一次性的，租户不是。这套部署最早的答案是每租户一个宿主目录——沙箱宿主机上的普通目录——它把
文件还给了租户，却没有给任何东西设界：一个 `dd` 就能填满宿主磁盘，把所有租户连同 CubeSandbox 自己
一起带走。访问是隔离的，容量不是。

## 为什么用 JuiceFS 而不是直接挂 S3

最直觉的实现是用 s3fs 或 `rclone mount` 挂载每个 volume 的前缀。两者都试过，都不可用，而原因与速度
无关：它们把文件系统调用翻译成对象调用，而 S3 没有硬链接。harness 靠把临时文件硬链接覆盖到正式文件
上来原子替换会话日志，于是每个回合都立刻以

```
EIO: i/o error, link '…/session.jsonl.zstd.<tmp>' -> '…/session.jsonl.zstd'
```

结束，且没有任何助手消息——模型答了，日志写没活下来。

这是那类挂载器的性质，不是对象存储的性质。JuiceFS 是一个恰好把数据放在对象存储里的文件系统：
**元数据存放在事务型数据库中**，因此硬链接、原子 rename 与文件锁都是它们字面的意思，而对象存储自始
至终只保存数据块。本部署实测：`ln` 得到 `links=2`，`ln -f` 原子替换成功，`flock` 正常返回。

## 为什么只挂一次、再用 bind

attach 处在租户首个请求的路径上，而 CubeSandbox 从快照恢复一个沙箱约需半秒。任何在那里做拷贝、下载
或起进程的动作都会成为系统里最慢的一环——早先一版在 attach 时取回每租户的磁盘镜像，耗时 **8 秒**，
相对同一模板不带 volume 的情形是十六倍的回归。

所以每个节点只挂一个 JuiceFS 客户端，且只挂一次，每个 volume 都是其中某个目录的 bind mount。bind
就是一次系统调用：**attach 耗时 0.06 秒**，不搬任何字节。带 volume 的启动回到 0.4–1.4 秒，这是平台
的数字，不是这个插件的。

沙箱只看得见属于自己的那个目录，因为只有那个目录被 bind 进去。

## 容量

两道上限，都由 JuiceFS 强制执行：

- **整套部署**——格式化时的 `--capacity`。
- **每租户**——目录配额，由本插件在 `create` 时设置。写超会在该租户自己的沙箱里得到 `EDQUOT`，
  影响不到任何其他人。已通过往 2 GiB 的 volume 里写 3 GiB 验证。

每个租户一个数字，而不是每个账号一个：CubeSandbox 在任何钩子里交给插件的都只有一个 volume id
和一个名字，没有容量可接收，也没有任何地方能传进按账号的容量。调高 `VOLUME_CAPACITY_GB` 只对此后
创建的 volume 生效；已有的会保持创建时的数字，直到对它们跑一次 `juicefs quota set`。

两道上限彼此独立，因此「每租户的数字 × 租户数」可以超过文件系统自身的容量——每人 5 GiB，二十个
租户就越过 100 GiB。这是超售而非配置错误：部署级上限依然成立，最后写的那位租户会先撞上它。

被删除的数据在 JuiceFS 回收站保留期之后才回收，因此释放出的空间是次日归还，而不是立刻。

## 性能

一个带持久化元数据的网络文件系统不可能追上本地盘，调优之前先知道差距在哪。单节点实测，每个
小文件创建的耗时，本地盘为 0.06ms：

| | 创建 | 重复 `stat` |
|---|---|---|
| 全部默认 | 38ms | 1.0ms |
| `WRITEBACK=on` + 本地缓存 + 30 秒元数据超时 | 20ms | 0.007ms |
| 再加元数据库 `synchronous_commit=off` | 8ms | 0.007ms |
| 再改用 Redis 作元数据引擎 | 3ms | 0.14ms |

各自买到了什么：

- **`WRITEBACK=on`** 是这个插件能做的最大一项改动。不开时每次 `close` 都要等一个对象上传完；
  开启后，写入在落到本地盘暂存的那一刻就被确认。代价是：节点若在积压上传排空之前丢失，那部分
  数据随之丢失，而元数据里这个文件仍然存在。
- **`CACHE_DIR` / `CACHE_SIZE_MB`** 总是显式传入，因为 JuiceFS 自己的默认值会把一个 100 GiB
  的缓存放进挂载者的家目录——由 Cubelet 执行钩子，也就是 root 的家目录——落在哪个文件系统上
  全凭巧合。
- **元数据超时**延长的是一个本就存在的缓存，而不是凭空造一个：即便在 1 秒的默认值下，重复
  `stat` 也只要 0.007ms，冷读才是 1.0ms。调高它有利于那些隔几秒又回头访问同一批文件的负载，
  且只有在「一个目录只有一个写者」时才安全。这里成立，因为一个 volume 只挂给它租户的那一个
  沙箱；一旦两个节点同时写同一个 volume，它就不再成立。

有两个开关有意不归这个插件管：

- **`synchronous_commit`** 属于元数据库，因此「安装」一节在那里关掉它，而不是在这里。每一次
  持久化提交都要一次 WAL fsync——实测 2.9ms，关闭后 0.33ms——而一次文件创建要花掉好几次。
  它交出去的是「非正常关机时最后零点几秒的元数据」；不能接受这一点的部署就保持默认，停在
  上表 20ms 那一行。
- **元数据引擎**就是 `META`，所以换 Redis 不需要改代码。它不是挡在 Postgres 前面的缓存——
  JuiceFS 没有这种模式——而是另一个文件系统，要在 volume 全部卸载的情况下用 `juicefs dump`
  与 `juicefs load` 迁移过去。它用 Postgres 的持久性换取常驻内存的元数据。

## 它适合与不适合什么

JuiceFS 是文件系统，因此关于对象存储挂载的那些常见告诫并不适用：随机写不会重写整个对象，`rename`
不是「复制再删除」，锁也能跨节点生效。会话日志、SQLite 文件、构建缓存放在这里都没问题。

取而代之的依赖是元数据数据库。每个执行挂载的节点都必须能连上它；失去它的客户端会把挂载留在挂载表里，
同时对每个调用返回 `EIO`——这正是本插件检查共享挂载**能否被读取**、而不是它是否存在，并在读不了时换掉
它的原因。丢失这个数据库等于一次性丢掉所有 volume，因此它应当和这套部署其他持久状态一起备份。

`refCount` 是按节点统计的：同一节点上的两个沙箱共用那一个客户端，同一 volume 在第二个节点上会挂载
自己的一份。

## 检查节点

```sh
./install-deps.sh --check-only    # reports jq, juicefs, /dev/fuse; changes nothing
sudo ./install-deps.sh            # installs what is missing
```

钩子里也做同样的检查，但它们运行时租户已经在等了。

## 排错

| 现象 | 该看哪里 |
| --- | --- |
| `unknown driver: juicefs` | CubeMaster 的 `volume_plugins` 缺这一条，或没重启 |
| `no plugin registered for driver "juicefs"` | Cubelet 缺同名条目，或没重启 |
| `missing on this node: juicefs` | 在那个节点上跑 `install-deps.sh` |
| 每个调用都返回 `EIO` | 元数据数据库不可达；恢复后插件会自行换掉挂载 |
| attach 挂载失败 | 先看 `ls /dev/fuse`，再手工执行挂载以读到 JuiceFS 自己的报错 |
| 租户看到 `EDQUOT` | 他的 volume 满了——`juicefs quota get $META --path /volumes/<id>` |

## 安装

```sh
# once, anywhere that can reach both the database and the object store
createdb -h host -U user juicefs

# A file create spends several metadata commits, and each durable one costs a
# WAL fsync — 2.9ms against 0.33ms without, which is most of what a create
# costs once WRITEBACK is on. Scoped to this database, so the deployment's
# accounts and tokens keep their default durability. The trade is the last
# fraction of a second of metadata on an unclean shutdown; see Performance.
psql -h host -U user -d postgres \
  -c "ALTER DATABASE juicefs SET synchronous_commit = off"

juicefs format --storage s3 --bucket http://<endpoint>/<bucket> \
  --access-key <key> --secret-key <secret> --capacity 100 \
  postgres://user:pass@host:5432/juicefs?sslmode=disable dsh-volumes

# on every CubeMaster and Cubelet node
install -m 755 cube-volume-juicefs /usr/local/services/cubetoolbox/CubeMaster/plugin/
install -m 755 cube-volume-juicefs /usr/local/services/cubetoolbox/Cubelet/plugin/
install -m 600 volume-juicefs.conf /usr/local/services/cubetoolbox/CubeMaster/plugin/
install -m 600 volume-juicefs.conf /usr/local/services/cubetoolbox/Cubelet/plugin/
```

```yaml
# CubeMaster conf.yaml
volume_plugins:
  - name: juicefs
    type: binary
    binary_path: /usr/local/services/cubetoolbox/CubeMaster/plugin/cube-volume-juicefs
```

```toml
# Cubelet config.toml
[[plugins."io.cubelet.internal.v1.storage".volume_plugins]]
  name        = "juicefs"
  type        = "binary"
  binary_path = "/usr/local/services/cubetoolbox/Cubelet/plugin/cube-volume-juicefs"
```

两处的名字必须一致，两个组件都要重启。节点依赖：`juicefs` 与 `jq`。

元数据数据库必须对每个执行挂载的节点可达。一个失去元数据库的客户端仍会把挂载留在挂载表里，并对每个
调用返回 `EIO`，因此本插件检查的是共享挂载**能否被读取**，而不是它是否存在，读不了就换掉它。

## 契约

四个钩子，每次调用一个子进程，stdout 一行 JSON。`create` 与 `destroy` 属于 CubeMaster，`attach` 与
`detach` 属于 Cubelet，并带一个节点内的 `refCount`——attach 时为 0 表示本节点上的第一个沙箱，detach
时为 0 表示最后一个。随附的腾讯 COS 示例是这一切的参考。
