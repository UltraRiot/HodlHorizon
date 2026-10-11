export function selectTemplate(pool, context, recentlyUsedIds) {
  const applicablePool = pool.filter((t) => !t.applicable || t.applicable(context));
  const usedSet = new Set(recentlyUsedIds);
  const fresh = applicablePool.filter((t) => !usedSet.has(t.id));
  const candidates = fresh.length > 0 ? fresh : applicablePool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
