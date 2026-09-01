export const ENGINE_MAX_VISITS = 50_000;
export const ENGINE_MAX_TIME_MS = 300_000;

/**
 * App-level analysis batch size. The setting is intentionally not exposed in
 * the UI: a single job per network pass keeps cancellation responsive while a
 * player moves or a newer position supersedes the search.
 */
export const DEFAULT_KATAGO_BATCH_SIZE = 1;
