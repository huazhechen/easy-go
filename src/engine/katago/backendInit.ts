import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import '@tensorflow/tfjs-backend-wasm';
import { setThreadsCount, setWasmPaths } from '@tensorflow/tfjs-backend-wasm';

import type { KataGoBackendPreference } from '../../types';
import { publicUrl } from '../../utils/publicUrl';

async function initWasmBackend(): Promise<void> {
  try {
    // Vite serves `public/` at the site root.
    setWasmPaths(publicUrl('tfjs/'));
    // Use a reasonable thread count for XNNPACK when cross-origin isolated
    // (SharedArrayBuffer). Without COOP/COEP headers, browsers disable threads
    // and TFJS falls back to single-threaded wasm.
    const isCrossOriginIsolated =
      (globalThis as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
    if (isCrossOriginIsolated) {
      const hc =
        (globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator
          ?.hardwareConcurrency ?? 1;
      setThreadsCount(Math.max(1, Math.min(8, Math.floor(hc))));
    }
    await tf.setBackend('wasm');
    await tf.ready();
    return;
  } catch {
    // Fall through to CPU below.
  }

  await tf.setBackend('cpu');
  await tf.ready();
}

/** Initialises TensorFlow.js on the requested backend, falling back as needed. */
export async function initBackend(preferredBackend: KataGoBackendPreference): Promise<void> {
  if (preferredBackend === 'cpu') {
    await tf.setBackend('cpu');
    await tf.ready();
    return;
  }

  if (preferredBackend === 'webgpu') {
    try {
      await tf.setBackend('webgpu');
      await tf.ready();
      return;
    } catch {
      // Fall back to WASM/CPU if WebGPU isn't available or fails to initialize.
    }
  }

  await initWasmBackend();
}
