import type { GameRules, GameSettings, KataGoBackendPreference } from '../types';
import { DEFAULT_BOARD_SIZE } from '../types';
import { publicUrl } from '../utils/publicUrl';
import { readLocalStorage, writeLocalStorage } from '../utils/storage';
import { LEGACY_SETTINGS_STORAGE_KEYS, SETTINGS_STORAGE_KEY } from '../utils/storageKeys';
import { defaultModelUrl, KATAGO_RECOMMENDED_MODEL_URL, KATAGO_SMALL_MODEL_PATH } from '../engine/katago/modelDefaults';
import { DEFAULT_KATAGO_BATCH_SIZE } from '../engine/katago/limits';

const OLD_DEFAULT_KATAGO_VISITS = 500;
export const DEFAULT_KATAGO_VISITS = 5000;

const normalizeModelUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(blob:|data:)/i.test(trimmed)) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    if (trimmed.startsWith('/models/')) return publicUrl(trimmed.slice(1));
    return trimmed;
  }
  if (trimmed.startsWith('models/')) return publicUrl(trimmed);
  return trimmed;
};

const normalizeKataGoBackend = (value: unknown): KataGoBackendPreference | null => {
  return value === 'wasm' || value === 'webgpu' || value === 'cpu' ? value : null;
};

const isLegacyDefaultModelUrl = (value: string): boolean => {
  const legacyPath = `/${KATAGO_SMALL_MODEL_PATH}`;
  return (
    value === KATAGO_RECOMMENDED_MODEL_URL ||
    value === publicUrl(KATAGO_SMALL_MODEL_PATH) ||
    value === KATAGO_SMALL_MODEL_PATH ||
    value === legacyPath ||
    value.endsWith(legacyPath)
  );
};

/** Resolves a stored model URL into something fetch() can load. */
export const resolveModelUrlForFetch = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(blob:|data:|https?:|file:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return trimmed;
  if (typeof window === 'undefined') return trimmed;
  // Absolute paths (starting with /) resolve against the origin.
  if (trimmed.startsWith('/')) return new URL(trimmed, window.location.origin).toString();
  // Relative paths resolve against the current page href.
  return new URL(trimmed, window.location.href).toString();
};

const loadStoredSettings = (): Partial<GameSettings> | null => {
  try {
    const rawCurrent = readLocalStorage(SETTINGS_STORAGE_KEY);
    const legacyEntry = rawCurrent
      ? null
      : LEGACY_SETTINGS_STORAGE_KEYS.map((key) => ({ key, raw: readLocalStorage(key) })).find((entry) => entry.raw);
    const raw = rawCurrent ?? legacyEntry?.raw;
    if (!raw) return null;
    const isLegacySettings = legacyEntry != null;
    const isV1Settings = legacyEntry?.key === 'easy-go:settings:v1';
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Overlay toggles were removed when the UI stopped exposing them; drop any
    // stored values so they cannot linger in the serialized settings.
    for (const overlayKey of ['analysisShowChildren', 'analysisShowEval', 'analysisShowHints', 'analysisShowPolicy', 'analysisShowOwnership']) {
      delete (parsed as Record<string, unknown>)[overlayKey];
    }
    // These fields were moved out of persisted settings; drop any legacy copies
    // so they cannot linger in the serialized object.
    for (const removedKey of ['defaultBoardSize', 'defaultHandicap']) {
      delete (parsed as Record<string, unknown>)[removedKey];
    }
    // An uploaded human net lives in a blob: URL that dies with the page, so a
    // stored one would only produce a failing fetch on the next load.
    if ('katagoModelUrl' in parsed) {
      const normalized = normalizeModelUrl((parsed as { katagoModelUrl?: unknown }).katagoModelUrl);
      if (normalized) {
        (parsed as { katagoModelUrl: string }).katagoModelUrl = isLegacySettings && isLegacyDefaultModelUrl(normalized)
          ? publicUrl(KATAGO_SMALL_MODEL_PATH)
          : normalized;
      } else {
        delete (parsed as { katagoModelUrl?: unknown }).katagoModelUrl;
      }
    }
    if ('katagoBackend' in parsed) {
      const backend = normalizeKataGoBackend((parsed as { katagoBackend?: unknown }).katagoBackend);
      if (backend) {
        (parsed as { katagoBackend: KataGoBackendPreference }).katagoBackend =
          isV1Settings && backend === 'wasm' ? 'webgpu' : backend;
      } else {
        delete (parsed as { katagoBackend?: unknown }).katagoBackend;
      }
    }
    if ((parsed as { katagoVisits?: unknown }).katagoVisits === OLD_DEFAULT_KATAGO_VISITS) {
      (parsed as { katagoVisits: number }).katagoVisits = DEFAULT_KATAGO_VISITS;
    }
    return parsed as Partial<GameSettings>;
  } catch {
    return null;
  }
};

export const saveStoredSettings = (settings: GameSettings): void => {
  writeLocalStorage(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

export const rulesToSgfRu = (rules: GameRules): string => {
  switch (rules) {
    case 'japanese':
      return 'Japanese';
    case 'chinese':
      return 'Chinese';
    case 'korean':
      return 'Korean';
  }
};

export const defaultSettings: GameSettings = {
  soundEnabled: true,
  gameRules: 'japanese',
  katagoModelUrl: defaultModelUrl(),
  katagoBackend: 'webgpu',
  katagoVisits: DEFAULT_KATAGO_VISITS,
  // Continuous recommendation search starts at 32 visits; this is also the
  // default B10 tier's per-move thinking time (see modelDefaults).
  katagoMaxTimeMs: 2000,
  katagoBatchSize: DEFAULT_KATAGO_BATCH_SIZE,
  katagoMaxChildren: DEFAULT_BOARD_SIZE * DEFAULT_BOARD_SIZE,
  katagoTopK: 10,
  katagoReuseTree: true,
  katagoOwnershipMode: 'root',
  katagoWideRootNoise: 0.04,
  katagoRootPolicyTemperature: 1.0,
  katagoFillDameBeforePass: true,
  katagoAnalysisPvLen: 15,
  katagoNnRandomize: true,
  katagoConservativePass: true,
};

export const initialSettings: GameSettings = {
  ...defaultSettings,
  ...(loadStoredSettings() ?? {}),
  // Batch size is runtime-only and never restored from a previously stored
  // settings object, so a stale value cannot alter search behaviour.
  katagoBatchSize: DEFAULT_KATAGO_BATCH_SIZE,
};
