import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  // Prepend shebang so the output is directly executable
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  splitting: false,
  sourcemap: false,
});
