import { publicUrl } from '../../utils/publicUrl';

export const KATAGO_RECOMMENDED_MODEL_NAME = 'kata1-b18c384nbt-s9996604416-d4316597426';
export const KATAGO_RECOMMENDED_MODEL_URL =
  'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz';

export const KATAGO_SMALL_MODEL_PATH = 'models/katago-small.bin.gz';

// The three locally-hosted model tiers. B6 is the tiny bundled test network
// (3.7 MB gzipped), B10 is a 10-block 128-channel net (~11 MB gzipped), and
// B18 is the recommended b18c384nbt network (~96 MB gzipped).
export const KATAGO_B10_REMOTE_URL =
  'https://raw.githubusercontent.com/otrego/clamshell/21c3dfe291cc/katalyze/testdata/g170e-b10c128-s1141046784-d204142634.bin.gz';

export type KataGoModelTierId = 'b6' | 'b10' | 'b18';

export interface KataGoModelChunk {
  /** Path of one hosted chunk, relative to the site root. */
  path: string;
  /** Exact byte size of the chunk (for progress totals and validation). */
  bytes: number;
}

export interface KataGoModelTier {
  id: KataGoModelTierId;
  /** Short label shown in the UI, e.g. "B10". */
  label: string;
  /** Approximate download size in MB, shown as the "M" number. */
  sizeMb: number;
  /** Display form of the size, e.g. "10M". */
  sizeLabel: string;
  /** Real size of the decompressed `.bin` bytes (used for download progress). */
  decompressedBytes: number;
  /**
   * Optional chunked hosting: the tier's `.bin.gz` is split into several
   * files (≤24 MiB each so hosts with a 25 MiB per-file limit such as
   * Cloudflare can serve it). The client fetches every chunk in order and
   * concatenates them before decompressing and checksumming.
   */
  chunks?: readonly KataGoModelChunk[];
  /** Path under the site root (served from the same origin). */
  localPath: string;
  /**
   * CORS-friendly fallback used when the locally-hosted copy is unavailable
   * (for example a deployment that stripped the file). null = no fallback.
   */
  remoteUrl: string | null;
  /**
   * MD5 of the decompressed KataGo `.bin` bytes. Hosts often serve `.gz`
   * files with Content-Encoding: gzip (which the browser auto-decodes), so
   * validating after decompression keeps the check correct regardless of how
   * the server delivers the file. A mismatch re-fetches the model even when
   * the cache version number has not changed.
   */
  md5: string;
  /**
   * Per-move thinking time slider range (ms) for this tier: B6 1–10s,
   * B10 1–20s, B18 1–60s. Each tier keeps its own independent value.
   */
  minThinkingMs: number;
  /** Inclusive upper bound (ms). */
  maxThinkingMs: number;
  /** Slider step (ms); 1000 so the UI slides in whole seconds. */
  thinkingStepMs: number;
  /**
   * Default selected value (ms) — the middle of the tier's range. Switching
   * to a tier resets its thinking time to this value.
   */
  defaultThinkingMs: number;
  /**
   * B18 is ~96 MB, so selecting it goes through an explicit download dialog
   * with progress before it is cached and used.
   */
  requiresDownload: boolean;
  /** KataGo network name for tooltips/status. */
  modelName: string;
}

export const KATAGO_MODEL_TIERS: readonly KataGoModelTier[] = [
  {
    id: 'b6',
    label: 'B6',
    sizeMb: 6,
    sizeLabel: '6M',
    decompressedBytes: 4_124_446,
    localPath: KATAGO_SMALL_MODEL_PATH,
    remoteUrl: null,
    md5: '7c990719eb87a784407f30f18daeb105',
    minThinkingMs: 1_000,
    maxThinkingMs: 10_000,
    thinkingStepMs: 1_000,
    defaultThinkingMs: 5_000,
    requiresDownload: false,
    modelName: 'g170-b6c96-s175395328-d26788732',
  },
  {
    id: 'b10',
    label: 'B10',
    sizeMb: 10,
    sizeLabel: '10M',
    decompressedBytes: 12_003_218,
    localPath: 'models/katago-b10.bin.gz',
    remoteUrl: KATAGO_B10_REMOTE_URL,
    md5: 'da129716a16441bb01759e33c648d2c1',
    minThinkingMs: 1_000,
    maxThinkingMs: 20_000,
    thinkingStepMs: 1_000,
    defaultThinkingMs: 10_000,
    requiresDownload: false,
    modelName: 'g170e-b10c128-s1141046784-d204142634',
  },
  {
    id: 'b18',
    label: 'B18',
    sizeMb: 96,
    sizeLabel: '96M',
    decompressedBytes: 105_532_578,
    // 97,898,094 bytes = 3 × 25,165,824 (24 MiB) + 22,400,622.
    chunks: [
      { path: 'models/katago-b18.bin.gz.001', bytes: 25_165_824 },
      { path: 'models/katago-b18.bin.gz.002', bytes: 25_165_824 },
      { path: 'models/katago-b18.bin.gz.003', bytes: 25_165_824 },
      { path: 'models/katago-b18.bin.gz.004', bytes: 22_400_622 },
    ],
    localPath: 'models/katago-b18.bin.gz',
    remoteUrl: KATAGO_RECOMMENDED_MODEL_URL,
    md5: 'fb3e36c00914f5e3edaf123c06d1b4e3',
    minThinkingMs: 1_000,
    maxThinkingMs: 60_000,
    thinkingStepMs: 1_000,
    defaultThinkingMs: 30_000,
    requiresDownload: true,
    modelName: KATAGO_RECOMMENDED_MODEL_NAME,
  },
];

/** The default tier: B10 (with B6 as an automatic fallback when it is missing). */
export const DEFAULT_MODEL_TIER_ID: KataGoModelTierId = 'b10';

export const getModelTier = (id: string | null | undefined): KataGoModelTier | null =>
  KATAGO_MODEL_TIERS.find((tier) => tier.id === id) ?? null;

export const isKnownModelTierId = (id: unknown): id is KataGoModelTierId =>
  id === 'b6' || id === 'b10' || id === 'b18';

export const defaultThinkingForTier = (tier: KataGoModelTier | null | undefined): number =>
  tier?.defaultThinkingMs ?? 2000;

/** Snaps to the tier's slider step and clamps to its range. */
export const clampThinkingMs = (ms: number, tier: KataGoModelTier): number => {
  const stepped = Math.round(ms / tier.thinkingStepMs) * tier.thinkingStepMs;
  return Math.min(tier.maxThinkingMs, Math.max(tier.minThinkingMs, stepped));
};

export const modelTierByUrl = (url: string): KataGoModelTier | null => {
  const trimmed = url.trim();
  for (const tier of KATAGO_MODEL_TIERS) {
    if (trimmed === tier.localPath || trimmed.endsWith(`/${tier.localPath}`)) return tier;
    if (tier.remoteUrl && (trimmed === tier.remoteUrl || trimmed.endsWith(tier.remoteUrl))) return tier;
  }
  return null;
};

/** Expected MD5 of the .bin.gz bytes for a URL, when it maps to a known tier. */
export const expectedModelMd5 = (url: string): string | null => modelTierByUrl(url)?.md5 ?? null;

export const defaultModelUrl = (): string => {
  const tier = getModelTier(DEFAULT_MODEL_TIER_ID);
  return tier ? publicUrl(tier.localPath) : publicUrl(KATAGO_SMALL_MODEL_PATH);
};
