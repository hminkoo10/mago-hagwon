import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { pool: "threads", maxWorkers: 2, fileParallelism: false },
});
