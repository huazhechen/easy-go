import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The locally-hosted model tiers. B6 is KataGo's tiny test network and B10 a
// 10-block 128-channel net; both are served as single files from
// public/models. B18 (the recommended b18c384nbt network) is too large for
// hosts with a 25 MiB per-file limit (Cloudflare), so it is split into
// ≤24 MiB chunks that the app fetches and concatenates at runtime.
const MODELS = [
  {
    name: 'katago-small.bin.gz',
    url: 'https://raw.githubusercontent.com/lightvector/KataGo/master/cpp/tests/models/g170-b6c96-s175395328-d26788732.bin.gz',
    minBytes: 3_827_339,
    md5: 'cfe860ff0467a50aeab17a00d77b2699',
  },
  {
    name: 'katago-b10.bin.gz',
    url: 'https://raw.githubusercontent.com/otrego/clamshell/21c3dfe291cc/katalyze/testdata/g170e-b10c128-s1141046784-d204142634.bin.gz',
    minBytes: 11_138_361,
    md5: '77b77abb1873d5f7f08f75c56d6a990b',
  },
];

// The b18 file is ~96 MB: normal builds keep whatever copy is already present
// (typically committed to the repo), and only download when missing or when
// FETCH_B18_MODEL=1 is set explicitly.
const FETCH_B18_MODEL = process.env.FETCH_B18_MODEL === '1';
const FORCE = process.env.FETCH_MODEL_FORCE === '1';

const projectRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(projectRoot, 'public', 'models');

const B18_SOURCE_URL =
  'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz';
const B18_SOURCE_MD5 = 'efc406f90990b1fb96034f426e9965fe';
const B18_SOURCE_PATH = path.join(projectRoot, '.model-src', 'katago-b18.bin.gz');
const B18_CHUNK_BYTES = 25_165_824; // 24 MiB
const B18_TOTAL_BYTES = 97_898_094;
const B18_CHUNKS = [
  { name: 'katago-b18.bin.gz.001', bytes: B18_CHUNK_BYTES },
  { name: 'katago-b18.bin.gz.002', bytes: B18_CHUNK_BYTES },
  { name: 'katago-b18.bin.gz.003', bytes: B18_CHUNK_BYTES },
  { name: 'katago-b18.bin.gz.004', bytes: B18_TOTAL_BYTES - B18_CHUNK_BYTES * 3 },
];

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function md5File(p) {
  const buf = await fs.readFile(p);
  return createHash('md5').update(buf).digest('hex');
}

async function downloadModel(url, destPath, expectedMd5) {
  const name = path.basename(destPath);
  console.log(`Downloading ${name} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${name}: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const partPath = `${destPath}.part`;
  await fs.writeFile(partPath, buf);
  const actualMd5 = createHash('md5').update(buf).digest('hex');
  if (actualMd5 !== expectedMd5) {
    await fs.rm(partPath, { force: true });
    throw new Error(`Checksum mismatch for ${name}: expected ${expectedMd5}, got ${actualMd5}`);
  }
  await fs.rename(partPath, destPath);
  console.log(`Saved ${name} (${(buf.length / 1024 / 1024).toFixed(1)} MB, md5 ok)`);
}

async function ensureB18Chunks() {
  const complete = (await Promise.all(
    B18_CHUNKS.map(async (chunk) => {
      const p = path.join(outDir, chunk.name);
      try {
        return (await fs.stat(p)).size === chunk.bytes;
      } catch {
        return false;
      }
    })
  )).every(Boolean);
  if (complete && !FORCE) {
    console.log('B18 chunks already present (md5 verified at split time)');
    return;
  }
  if (!FETCH_B18_MODEL && !FORCE) {
    console.log('Skipping b18 chunks: missing (run with FETCH_B18_MODEL=1 to split the ~96 MB file)');
    return;
  }

  let srcPath = B18_SOURCE_PATH;
  if (!(await exists(srcPath))) {
    const legacy = path.join(outDir, 'katago-b18.bin.gz');
    if ((await exists(legacy)) && (await md5File(legacy)) === B18_SOURCE_MD5) {
      // Reuse the previously downloaded single file as the split source.
      srcPath = legacy;
    } else {
      await fs.mkdir(path.dirname(B18_SOURCE_PATH), { recursive: true });
      await downloadModel(B18_SOURCE_URL, B18_SOURCE_PATH, B18_SOURCE_MD5);
      srcPath = B18_SOURCE_PATH;
    }
  }
  const src = await fs.readFile(srcPath);
  if (src.length !== B18_TOTAL_BYTES) {
    throw new Error(`B18 source size mismatch: expected ${B18_TOTAL_BYTES}, got ${src.length}`);
  }

  let offset = 0;
  for (const chunk of B18_CHUNKS) {
    const part = src.subarray(offset, offset + chunk.bytes);
    if (part.length !== chunk.bytes) throw new Error(`B18 source too small for ${chunk.name}`);
    await fs.writeFile(path.join(outDir, chunk.name), part);
    offset += chunk.bytes;
  }

  // Remove the old single-file hosting and stale chunk files so Cloudflare
  // only ever sees ≤24 MiB assets.
  await fs.rm(path.join(outDir, 'katago-b18.bin.gz'), { force: true });
  const entries = await fs.readdir(outDir);
  for (const entry of entries) {
    if (/^katago-b18\.bin\.gz\.\d+$/.test(entry) && !B18_CHUNKS.some((chunk) => chunk.name === entry)) {
      await fs.rm(path.join(outDir, entry), { force: true });
    }
  }
  console.log(`B18 split into ${B18_CHUNKS.length} chunks (${(offset / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  for (const model of MODELS) {
    const outPath = path.join(outDir, model.name);
    const existingSize = (await exists(outPath)) ? (await fs.stat(outPath)).size : 0;
    const complete = existingSize >= model.minBytes;
    if (!FORCE && complete) {
      const actualMd5 = await md5File(outPath);
      if (actualMd5 === model.md5) {
        console.log(`Model already present: ${model.name} (md5 ok)`);
        continue;
      }
      console.log(`Checksum mismatch for ${model.name}: re-downloading`);
    }
    await downloadModel(model.url, outPath, model.md5);
  }
  await ensureB18Chunks();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
