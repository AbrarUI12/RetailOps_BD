import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const root = new URL("../dist/", import.meta.url);
const templateUrl = new URL("../public/sw.js", import.meta.url);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

const rootPath = root.pathname.replace(/^\/(.:\/)/, "$1");
const assets = (await files(rootPath))
  .filter((path) => !path.endsWith(`${sep}sw.js`))
  .map((path) => `/${relative(rootPath, path).split(sep).join("/")}`)
  .sort();
const digest = createHash("sha256")
  .update(assets.join("\n"))
  .digest("hex")
  .slice(0, 12);
const template = await readFile(templateUrl, "utf8");
await writeFile(
  new URL("sw.js", root),
  template
    .replace("__CACHE_VERSION__", `retailops-shell-${digest}`)
    .replace("__PRECACHE_MANIFEST__", JSON.stringify(assets)),
);
