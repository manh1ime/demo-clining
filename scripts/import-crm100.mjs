import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(root, "..", "CRM_100_компаний_группы_контакты.json");
const source = JSON.parse(await readFile(sourcePath, "utf8"));

if (source.format !== "cleaning-crm-prospects-v1") throw new Error(`Unsupported format: ${source.format}`);
if (!Array.isArray(source.prospects) || source.prospects.length !== 100) throw new Error(`Expected 100 prospects, found ${source.prospects?.length}`);

const output = JSON.stringify({
  meta: { format: source.format, generatedAt: source.generatedAt, notice: source.notice },
  prospects: source.prospects,
}, null, 2);

await writeFile(resolve(root, "leads-data.local.json"), output, "utf8");
console.log(`Imported ${source.prospects.length} prospects from ${source.format}`);
