# Deployment

Easy Go is a static Vite app. A production build emits `dist/`, which can be
served by GitHub Pages or any static host that can serve JavaScript, WASM,
compressed model files, and the service worker.

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
3. The GitHub repository name from `GITHUB_REPOSITORY`
4. `/`

The value is normalized to start and end with `/`. For a repository named
`easy-go`, GitHub Pages builds use `/easy-go/`.

Use an explicit base path when deploying somewhere unusual:

```sh
VITE_BASE_URL=/my/path/ npm run build
```

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. On pushes to
`main` or manual dispatch, it:

1. Checks out the repository with LFS enabled.
2. Sets up Node 24 with npm caching.
3. Runs `npm ci`.
4. Runs `npm run build`.
5. Uploads `dist/` as a Pages artifact.
6. Deploys through `actions/deploy-pages`.

The current live URL is:

https://huazhechen.github.io/easy-go/

## Headers

For best WASM performance, serve these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They enable `SharedArrayBuffer`, which TensorFlow.js WASM uses for threaded
execution.

The Vite dev and preview servers set the headers. The production build ships
`public/_headers`:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

Hosts such as Netlify and Cloudflare Pages can honor that file. GitHub Pages
does not support custom response headers, so WASM runs single-threaded there.
The app still works, and WebGPU is unaffected by this limitation.

## Service Worker and Offline Cache

The production app registers `sw.js` after page load. Development builds do not
register the service worker.

The service worker precaches:

- The app shell.
- Manifest and PWA icons/screenshots.
- The locally-hosted model tiers (`katago-small.bin.gz`, `katago-b10.bin.gz`,
  and the four `katago-b18.bin.gz.001`–`.004` chunks).
- TensorFlow.js WASM files.
- Built-in board and stone assets.

Navigation requests fall back to the cached app shell when offline. Static
assets are cache-first. Other same-origin GET requests are cached at runtime.

## Updates

The build emits `version.json` with package version, git hash, commit date, and
build date. Production clients poll that file periodically and on window focus.
When a new git hash is detected, the app can show an update-ready banner.

The service worker also listens for `SKIP_WAITING`, allowing the UI to activate
a waiting worker and reload.

## Static Host Checklist

- Serve `index.html`, `404.html`, `manifest.webmanifest`, `sw.js`, model files,
  WASM files, and generated JS/CSS from the same origin.
- The b18 model is hosted as four ≤24 MiB chunks
  (`katago-b18.bin.gz.001`–`.004`), so hosts with a 25 MiB per-file limit
  (Cloudflare Workers/Pages) can serve it; the client concatenates and
  MD5-checks the chunks before use.
- Preserve `.gz` model files as files; do not decompress or block them.
- If the host serves `.gz` with `Content-Encoding: gzip` (Vite dev, GitHub
  Pages and Netlify commonly do), that is fine: the app normalizes the
  response and validates the decompressed MD5 before use.
- Use the correct Vite base path for subdirectory deployments.
- Add COOP/COEP headers when the host supports them.
- Make sure `404.html` is deployed for SPA fallback on hosts that need it.

## Cloudflare 托管 B18（分片方案，已实现）

Cloudflare Workers 的静态资源（Static Assets）和 Cloudflare Pages 对单个
文件的限制都是 **25 MiB**，而 `models/katago-b18.bin.gz` 是 93.4 MiB
（97,898,094 字节），单文件无法直接托管。现在的做法是把 B18 切成 4 个
≤24 MiB 的分片（`katago-b18.bin.gz.001`–`.004`，每个 24 MiB，最后一个
21.4 MiB），前端按序 fetch 后拼接，再做 MD5 校验、解压和缓存。
`npm run fetch:model`（或 `FETCH_B18_MODEL=1 npm run fetch:model`）会自动
生成这些分片，Cloudflare Workers/Pages 可直接托管全部静态文件，无需 R2。

如果不想用分片，其他可行的替代方案（按推荐顺序）：

1. **保持 GitHub Pages（当前部署）**：GitHub Pages 单文件上限 100 MB，
   单文件 b18 可直接托管；建议配合 Git LFS 存放模型文件，仓库的部署工作流
   已启用 LFS。
2. **Cloudflare R2 + 公开桶/自定义域名**：R2 对象存储没有单文件 25 MiB
   限制；将 `public/models/katago-b18.bin.gz` 上传到 R2，开启公开桶（或
   用 Worker `fetch` 转发），并配置 CORS 允许站点跨域读取。
3. **其他对象存储 + CDN**：AWS S3 + CloudFront、Backblaze B2、阿里云 OSS、
   腾讯云 COS、七牛/又拍云等，均可托管 94 MB 文件并配 CDN 加速；注意为
   模型文件开启 CORS，否则浏览器端 `fetch` 会失败。
4. **GitHub Releases 分发**：release asset 上限 2 GB，但 release 下载域名
   不带 CORS 头，浏览器直连会被拦截，只适合脚本/客户端下载，不适合前端
   直接拉取。

`scripts/fetch-models.mjs` 会按 MD5 校验每个模型文件，部署前可用
`FETCH_B18_MODEL=1 npm run fetch:model` 生成 B18 分片。
