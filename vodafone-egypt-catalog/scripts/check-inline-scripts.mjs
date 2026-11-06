import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["index.html", "admin.html"];
let checked = 0;
for (const page of pages) {
  const file = path.join(root, page);
  const html = fs.readFileSync(file, "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    if (/\bsrc\s*=/i.test(match[1])) continue;
    const source = match[2].trim();
    if (!source) continue;
    new vm.Script(source, { filename: page + "#inline-script-" + (index + 1) });
    checked += 1;
  }
}
if (checked < 1) throw new Error("لم يتم العثور على سكربتات مضمنة لفحصها.");
console.log("نجح فحص " + checked + " كتلة JavaScript مضمنة في صفحات HTML.");
