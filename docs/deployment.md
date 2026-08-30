# Deployment

Easy Go is a static Vite app. A production build emits `dist/`, which can be
served by any static host that can serve JavaScript, WASM, and compressed model
files. The repository deploys to Cloudflare Workers with the static assets
served from the bundled Worker.

## Build

```sh
npm ci
npm run build
```

The build runs:

- TypeScript project build.
- Vite production build.
- Version metadata generation at `dist/version.json`.
- Copy/download prebuild hooks for TensorFlow.js WASM files and the small model.

Preview the result:

```sh
npm run preview
```

## Base Path

`vite.config.ts` computes the Vite base path in this order:

1. `VITE_BASE_URL`
2. `BASE_URL`
3. `/`

The value is normalized to start and end with `/`. Cloudflare deploys from the
site root.

Use an explicit base path when deploying somewhere unusual:

```sh
VITE_BASE_URL=/my/path/ npm run build
```

## Cloudflare Worker

The repository includes `.github/workflows/deploy-worker.yml`. On pushes to
`main` or manual dispatch, it:

1. Sets up Node 24 with npm caching.
2. Runs `npm ci`.
3. Runs `npm run build`.
4. Runs `npx wrangler deploy`.

`wrangler.jsonc` serves `dist/` through the Worker's `ASSETS` binding with
single-page-application fallback. The Worker also sets COOP/COEP headers on
every response so threaded WASM works in production.

## Headers

For best WASM performance, serve these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They enable `SharedArrayBuffer`, which TensorFlow.js WASM uses for threaded
execution.

The Vite dev and preview servers set the headers, and the Cloudflare Worker
adds them to production responses.

## Offline Caching

The app has no service worker. Browsers may cache the app shell normally, and
downloaded B18 model bytes are cached in IndexedDB (see Models and Performance
in the README), but there is no explicit offline cache.

## Updates

The build emits `version.json` with package version, git hash, commit date, and
build date.

## Static Host Checklist

- Serve `index.html`, model files, WASM files, and generated JS/CSS from the
  same origin.
- The b18 model is hosted as four ≤24 MiB chunks
  (`katago-b18.bin.gz.001`–`.004`), so hosts with a 25 MiB per-file limit
  (Cloudflare Workers/Pages) can serve it; the client concatenates and
  MD5-checks the chunks before use.
- Preserve `.gz` model files as files; do not decompress or block them.
- If the host serves `.gz` with `Content-Encoding: gzip` (Vite dev and common
  static hosts do), that is fine: the app normalizes the
  response and validates the decompressed MD5 before use.
- Use the correct Vite base path for subdirectory deployments.
- Add COOP/COEP headers when the host supports them.
## Cloudflare 托管 B18（分片方案，已实现）

Cloudflare Workers 的静态资源（Static Assets）和 Cloudflare Pages 对单个
文件的限制都是 **25 MiB**，而 `models/katago-b18.bin.gz` 是 93.4 MiB
（97,898,094 字节），单文件无法直接托管。现在的做法是把 B18 切成 4 个
≤24 MiB 的分片（`katago-b18.bin.gz.001`–`.004`，每个 24 MiB，最后一个
21.4 MiB），前端按序 fetch 后拼接，再做 MD5 校验、解压和缓存。
`npm run fetch:model`（或 `FETCH_B18_MODEL=1 npm run fetch:model`）会自动
生成这些分片，Cloudflare Workers/Pages 可直接托管全部静态文件，无需 R2。

如果不想用分片，其他可行的替代方案（按推荐顺序）：

1. **Cloudflare R2 + 公开桶/自定义域名**：R2 对象存储没有单文件 25 MiB
   限制；将 `public/models/katago-b18.bin.gz` 上传到 R2，开启公开桶（或
   用 Worker `fetch` 转发），并配置 CORS 允许站点跨域读取。
2. **其他对象存储 + CDN**：AWS S3 + CloudFront、Backblaze B2、阿里云 OSS、
   腾讯云 COS、七牛/又拍云等，均可托管 94 MB 文件并配 CDN 加速；注意为
   模型文件开启 CORS，否则浏览器端 `fetch` 会失败。
3. **GitHub Releases 分发**：release asset 上限 2 GB，但 release 下载域名
   不带 CORS 头，浏览器直连会被拦截，只适合脚本/客户端下载，不适合前端
   直接拉取。

`scripts/fetch-models.mjs` 会按 MD5 校验每个模型文件，部署前可用
`FETCH_B18_MODEL=1 npm run fetch:model` 生成 B18 分片。
