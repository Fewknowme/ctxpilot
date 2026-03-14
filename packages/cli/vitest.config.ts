import { defineConfig } from "vitest/config";

export const vitestConfig = defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"]
  }
});

export default vitestConfig;
