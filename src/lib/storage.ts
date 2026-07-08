export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    if (!value) return fallback;
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function writeLocal<T>(key: string, value: T): { ok: true } | { ok: false; message: string } {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch {
    return {
      ok: false,
      message: "Could not save locally. You can continue using the app during this session."
    };
  }
}

export const storageKeys = {
  lastSearch: "creator_signal_last_search",
  shortlist: "creator_signal_shortlist",
  campaigns: "creator_signal_campaigns",
  drafts: "creator_signal_drafts"
} as const;
