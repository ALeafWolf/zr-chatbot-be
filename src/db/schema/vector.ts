import { customType } from "drizzle-orm/pg-core";

export const vectorCol = customType<{
  data: number[];
  config: { dimensions: number };
  driverData: string;
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    if (Array.isArray(value)) return value as unknown as number[];
    return value
      .slice(1, -1)
      .split(",")
      .map(Number);
  },
});
