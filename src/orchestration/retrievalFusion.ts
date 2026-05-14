export interface FuseByIdOptions<T> {
  getId: (item: T) => string;
  getScore?: (item: T) => number | null | undefined;
  rrfK?: number;
}

interface FusedItem<T> {
  item: T;
  score: number;
  bestItemScore: number;
  firstSeen: number;
}

function itemScore<T>(
  item: T,
  getScore: FuseByIdOptions<T>["getScore"],
): number {
  const value = getScore?.(item);
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function fuseById<T>(
  primary: T[],
  secondary: T[],
  options: FuseByIdOptions<T>,
): T[] {
  if (secondary.length === 0) return primary;
  if (primary.length === 0) return secondary;

  const rrfK = options.rrfK ?? 60;
  const fused = new Map<string, FusedItem<T>>();
  let seen = 0;

  const addList = (items: T[]) => {
    items.forEach((item, rank) => {
      const id = options.getId(item);
      const score = 1 / (rrfK + rank + 1);
      const bestItemScore = itemScore(item, options.getScore);
      const existing = fused.get(id);
      if (!existing) {
        fused.set(id, {
          item,
          score,
          bestItemScore,
          firstSeen: seen++,
        });
        return;
      }

      existing.score += score;
      if (bestItemScore > existing.bestItemScore) {
        existing.item = item;
        existing.bestItemScore = bestItemScore;
      }
    });
  };

  addList(primary);
  addList(secondary);

  return [...fused.values()]
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .map((entry) => entry.item);
}
