import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".release");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const files = ["main.js", "manifest.json", "styles.css", "README.md", "SECURITY.md", "LICENSE"];
for (const file of files) cpSync(join(root, file), join(output, file));
const readme = join(output, "README.md");
writeFileSync(readme, readFileSync(readme, "utf8").replace(/\n## Preview[\s\S]*?(?=\n## Setup)/, ""));
const checked = spawnSync(process.execPath, [join(root, "scripts/check-package.mjs"), output], { stdio: "inherit" });
if (checked.status !== 0) {
  rmSync(output, { recursive: true, force: true });
  process.exit(1);
}
console.log("Approved release staging is ready.");
