/**
 * Keyed async TTL memoizer. Collapses concurrent cache-miss calls into one
 * in-flight load so we don't stampede the same shed-server / gh invocation.
 */
export function ttlMemoize<K extends string, V>(
  ttlMs: number,
): (key: K, load: () => Promise<V>) => Promise<V> {
  const store = new Map<K, { value: V; fetchedAt: number }>();
  const inflight = new Map<K, Promise<V>>();

  return async (key, load) => {
    const hit = store.get(key);
    if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit.value;

    const existing = inflight.get(key);
    if (existing) return existing;

    const p = load()
      .then((value) => {
        store.set(key, { value, fetchedAt: Date.now() });
        return value;
      })
      .finally(() => inflight.delete(key));

    inflight.set(key, p);
    return p;
  };
}
