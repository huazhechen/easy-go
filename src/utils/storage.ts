function getBrowserStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined') return window.localStorage ?? null;
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    if (!descriptor || !('value' in descriptor)) return null;
    return (descriptor.value as Storage | undefined) ?? null;
  } catch {
    return null;
  }
}

function getLocalStorage(): Storage | null {
  return getBrowserStorage();
}

export function readLocalStorage(key: string): string | null {
  try {
    return getLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): boolean {
  try {
    const storage = getLocalStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
