import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_TIER_ID,
  defaultModelUrl,
  getModelTier,
  isKnownModelTierId,
  KATAGO_B10_REMOTE_URL,
  KATAGO_MODEL_TIERS,
  KATAGO_SMALL_MODEL_PATH,
  modelTierByUrl,
} from '../src/engine/katago/modelDefaults';

describe('KataGo model tier catalog', () => {
  it('defaults to B10 and hosts all three tiers locally', () => {
    expect(DEFAULT_MODEL_TIER_ID).toBe('b10');
    expect(KATAGO_MODEL_TIERS.map((tier) => tier.id)).toEqual(['b6', 'b10', 'b18']);
    for (const tier of KATAGO_MODEL_TIERS) {
      expect(tier.localPath).toMatch(/^models\/katago-.+\.bin\.gz$/);
      expect(tier.md5).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(KATAGO_MODEL_TIERS[1]!.sizeLabel).toBe('10M');
    expect(KATAGO_MODEL_TIERS[2]!.sizeLabel).toBe('96M');
    expect(KATAGO_MODEL_TIERS[2]!.requiresDownload).toBe(true);
    expect(KATAGO_MODEL_TIERS[0]!.requiresDownload).toBe(false);
  });

  it('pins the decompressed .bin MD5 for each tier', () => {
    expect(getModelTier('b6')?.md5).toBe('7c990719eb87a784407f30f18daeb105');
    expect(getModelTier('b10')?.md5).toBe('da129716a16441bb01759e33c648d2c1');
    expect(getModelTier('b18')?.md5).toBe('fb3e36c00914f5e3edaf123c06d1b4e3');
  });

  it('gives each tier its own independent thinking time slider range', () => {
    const [b6, b10, b18] = KATAGO_MODEL_TIERS;
    expect(b6!.minThinkingMs).toBe(1000);
    expect(b6!.maxThinkingMs).toBe(15000);
    expect(b10!.minThinkingMs).toBe(2000);
    expect(b10!.maxThinkingMs).toBe(30000);
    expect(b18!.minThinkingMs).toBe(5000);
    expect(b18!.maxThinkingMs).toBe(60000);
    for (const tier of KATAGO_MODEL_TIERS) {
      expect(tier.minThinkingMs).toBeLessThan(tier.maxThinkingMs);
      expect(tier.defaultThinkingMs).toBeGreaterThanOrEqual(tier.minThinkingMs);
      expect(tier.defaultThinkingMs).toBeLessThanOrEqual(tier.maxThinkingMs);
      expect(tier.minThinkingMs % 1000).toBe(0);
      expect(tier.maxThinkingMs % 1000).toBe(0);
      expect(tier.thinkingStepMs).toBe(1000);
    }
    // Defaults are the middle of each range: B6 5s / B10 10s / B18 30s.
    expect(b6!.defaultThinkingMs).toBe(5000);
    expect(b10!.defaultThinkingMs).toBe(10000);
    expect(b18!.defaultThinkingMs).toBe(30000);
    // Real decompressed sizes, used for consistent download progress.
    expect(b6!.decompressedBytes).toBe(4_124_446);
    expect(b10!.decompressedBytes).toBe(12_003_218);
    expect(b18!.decompressedBytes).toBe(105_532_578);
  });

  it('hosts b18 as ≤24 MiB chunks that reconstruct the full file', () => {
    const b18 = getModelTier('b18')!;
    expect(b18.chunks).toHaveLength(4);
    const total = b18.chunks!.reduce((sum, chunk) => sum + chunk.bytes, 0);
    expect(total).toBe(97_898_094);
    for (const chunk of b18.chunks!) {
      expect(chunk.bytes).toBeGreaterThan(0);
      expect(chunk.bytes).toBeLessThanOrEqual(25_165_824); // 24 MiB
      expect(chunk.path).toMatch(/^models\/katago-b18\.bin\.gz\.\d{3}$/);
    }
    expect(getModelTier('b6')?.chunks).toBeUndefined();
    expect(getModelTier('b10')?.chunks).toBeUndefined();
  });

  it('maps local and remote URLs back to their tier', () => {
    expect(modelTierByUrl(`/${KATAGO_SMALL_MODEL_PATH}`)?.id).toBe('b6');
    expect(modelTierByUrl(`/${KATAGO_MODEL_TIERS[1]!.localPath}`)?.id).toBe('b10');
    expect(modelTierByUrl(KATAGO_B10_REMOTE_URL)?.id).toBe('b10');
    expect(modelTierByUrl(`/base/${KATAGO_MODEL_TIERS[2]!.localPath}`)?.id).toBe('b18');
    expect(modelTierByUrl('https://example.com/other.bin.gz')).toBeNull();
  });

  it('points the default model URL at the local b10 file', () => {
    expect(defaultModelUrl()).toContain(KATAGO_MODEL_TIERS[1]!.localPath);
  });

  it('validates tier ids', () => {
    expect(isKnownModelTierId('b18')).toBe(true);
    expect(isKnownModelTierId('b99')).toBe(false);
    expect(getModelTier('b6')?.sizeMb).toBe(6);
    expect(getModelTier('nope')).toBeNull();
  });
});
