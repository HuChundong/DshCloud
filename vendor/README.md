# Vendored packages

English | [中文](README.zh.md)

One file, and it is here for one reason: `@cubesandbox/sdk` is not published
to npm. The package exists — version 0.3.0, in `sdk/node/` of the
CubeSandbox repository, with `dist` and a `prepublishOnly` script — but
`npm view @cubesandbox/sdk` answers 404, so there is nothing to depend on by
name.

The alternative was to keep writing the client ourselves, which is what this
deployment did until now and what `AGENTS.md` has a rule against. A build
artifact in the tree is the smaller of the two problems: it is one file, it is
obviously generated, and it goes away the day the package is published.

## Rebuilding it

```sh
git -C ../CubeSandbox fetch && git -C ../CubeSandbox merge --ff-only origin/master
cd ../CubeSandbox/sdk/node && npm install && npm run build
npm pack --pack-destination ../../../DshCloud/vendor
```

Then point `gateway/package.json` at the new version.

| package | version | built from |
| --- | --- | --- |
| `@cubesandbox/sdk` | 0.3.0 | TencentCloud/CubeSandbox `981ccda4` |
