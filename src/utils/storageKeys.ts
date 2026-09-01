/**
 * Single source of truth for the app's localStorage key names. Keeping them
 * together makes version bumps and cross-module lookups easy to audit.
 */
export const SETTINGS_STORAGE_KEY = 'easy-go:settings:v3';
export const LEGACY_SETTINGS_STORAGE_KEYS = ['easy-go:settings:v2', 'easy-go:settings:v1'] as const;

export const GAME_STORAGE_KEY = 'easy-go:game:v1';
export const OPENING_STORAGE_KEY = 'easy-go:opening:v1';

export const MODEL_TIER_STORAGE_KEY = 'easy-go:model-tier';
export const MODEL_THINKING_STORAGE_KEY = 'easy-go:model-thinking-ms';
