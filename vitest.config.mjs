import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/* Node environment on purpose: everything under test here is pure logic —
   scoring, gaps, trends, suppression rules. No jsdom, no React renderer, so the
   suite stays fast enough to run on every save. Component and end-to-end tests
   are a separate decision; when they arrive they belong in their own project
   rather than slowing this one down. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,mjs}"],
    globals: false,
    coverage: {
      provider: "v8",
      include: ["app/lib/**/*.js"],
      exclude: ["app/lib/reportgen.js", "app/lib/charts.js"], // DOM/docx, not unit-testable here
      reporter: ["text", "html"],
    },
  },
});
