import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(root, "functions", "generated");
const sources = ["exchange-rates", "plan-definitions", "regions", "validation-snapshot"];

await mkdir(outputDirectory, { recursive: true });
await Promise.all(sources.map(async (name) => {
  const source = JSON.parse(await readFile(resolve(root, "data", `${name}.json`), "utf8"));
  await writeFile(
    resolve(outputDirectory, `${name}.mjs`),
    `const data = ${JSON.stringify(source)};\nexport default data;\n`,
  );
}));
