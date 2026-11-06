import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.resolve(here, "../data/products.json");
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQMtjuBbuhznCQAYPLUsEj_K6CHGuDaK1Y0ti8Gqo7bShVpC-JzisbIKyMJTAz5nk4Bb7ywJLHunGX6/pub?output=csv";
const MIN_PRODUCT_COUNT = 130;
const EXPECTED_COLUMNS = [
  "id", "name_ar", "brand", "category", "variant", "price", "old_price",
  "currency", "status", "availability", "image", "product_url", "source_url",
  "source_checked_at", "source_note", "description", "image_credit"
];

function parseCsv(input) {
  const source = String(input || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"' && value.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value);
      if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else if (char === '"') {
      throw new Error("CSV يحتوي على علامة اقتباس غير صحيحة.");
    } else {
      value += char;
    }
  }

  if (quoted) throw new Error("CSV انتهى قبل إغلاق علامة الاقتباس.");
  if (value.length || row.length) {
    row.push(value);
    if (row.some(cell => String(cell).trim() !== "")) rows.push(row);
  }
  if (rows.length < 2) throw new Error("ملف Google Sheets لا يحتوي على صفوف منتجات.");

  const headers = rows.shift().map((header, index) =>
    String(header || "").trim().replace(index === 0 ? /^\uFEFF/ : /$^/, "")
  );
  const missing = EXPECTED_COLUMNS.filter(column => !headers.includes(column));
  if (missing.length) throw new Error("أعمدة ناقصة في الشيت: " + missing.join(", "));

  return rows.map((cells, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [
      header, String(cells[index] ?? "").trim()
    ]));
    if (cells.length > headers.length && cells.slice(headers.length).some(cell => String(cell).trim())) {
      throw new Error("عدد أعمدة غير متوقع في الصف " + (rowIndex + 2) + ".");
    }
    return record;
  }).filter(record => record.id);
}

function validHttps(value, field, id, required = false) {
  if (!value) {
    if (required) throw new Error(id + ": رابط " + field + " مطلوب.");
    return;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error(id + ": رابط " + field + " غير صالح."); }
  if (url.protocol !== "https:") throw new Error(id + ": رابط " + field + " يجب أن يستخدم HTTPS.");
}

function asProduct(row, index, seen) {
  const id = row.id.trim();
  if (!id) throw new Error("معرّف المنتج فارغ في السطر " + (index + 2) + ".");
  if (seen.has(id)) throw new Error("معرّف منتج مكرر: " + id);
  seen.add(id);

  for (const field of ["name_ar", "brand", "category", "variant"]) {
    if (!row[field]) throw new Error(id + ": الحقل " + field + " مطلوب.");
  }

  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(id + ": السعر يجب أن يكون رقماً موجباً.");
  const oldPrice = row.old_price === "" ? null : Number(row.old_price);
  if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice <= 0)) {
    throw new Error(id + ": السعر السابق غير صالح.");
  }
  if (row.currency && row.currency !== "EGP") throw new Error(id + ": العملة يجب أن تكون EGP.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.source_checked_at)) {
    throw new Error(id + ": تاريخ آخر تحقق يجب أن يكون YYYY-MM-DD.");
  }
  const parsedDate = new Date(row.source_checked_at + "T00:00:00Z");
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== row.source_checked_at) {
    throw new Error(id + ": تاريخ آخر تحقق غير صالح.");
  }
  if (!["in", "limited", "out", "unknown", "check"].includes(row.status)) {
    throw new Error(id + ": حالة المخزون غير معروفة (" + row.status + ").");
  }

  validHttps(row.source_url, "المصدر", id, true);
  validHttps(row.product_url, "صفحة المنتج", id);
  validHttps(row.image, "الصورة", id);

  return {
    id,
    name_ar: row.name_ar,
    brand: row.brand,
    category: row.category,
    variant: row.variant,
    price,
    old_price: oldPrice,
    currency: row.currency || "EGP",
    availability: row.availability || "",
    status: row.status || "unknown",
    image: row.image || null,
    image_credit: row.image_credit || null,
    description: row.description || "",
    product_url: row.product_url || null,
    source_url: row.source_url,
    source_checked_at: row.source_checked_at,
    source_note: row.source_note || ""
  };
}

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(SHEET_CSV_URL, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/csv,text/plain;q=0.9,*/*;q=0.1" }
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error("Google Sheets أعاد HTTP " + response.status + ".");
  const csv = await response.text();
  if (/<html[\s>]|<!doctype html/i.test(csv.slice(0, 2000))) {
    throw new Error("الرابط لم يُرجع CSV؛ تأكد أن الورقة منشورة للويب بصيغة CSV.");
  }

  const rows = parseCsv(csv);
  if (rows.length < MIN_PRODUCT_COUNT) {
    throw new Error("تم رفض التحديث الآمن: وصل " + rows.length + " صفاً فقط، والحد الأدنى " + MIN_PRODUCT_COUNT + ".");
  }
  const seen = new Set();
  const products = rows.map((row, index) => asProduct(row, index, seen));
  if (products.length !== rows.length) throw new Error("توجد صفوف غير مكتملة أو لا تحمل معرّفات.");

  const preview = {
    products: products.length,
    missingImages: products.filter(product => !product.image).length,
    missingProductLinks: products.filter(product => !product.product_url).length,
    needsReview: products.filter(product => product.status === "check" || product.status === "unknown").length
  };
  console.log("Google Sheets feed validated:", JSON.stringify(preview));

  if (process.argv.includes("--dry-run")) {
    console.log("Dry run: لم يتم تغيير أي ملف.");
    return;
  }

  const next = JSON.stringify(products, null, 2) + "\n";
  let current = "";
  try { current = await fs.readFile(dataFile, "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (current === next) {
    console.log("لا توجد تغييرات في بيانات المنتجات؛ لن يُنشأ commit.");
    return;
  }

  const temporary = dataFile + ".tmp";
  await fs.writeFile(temporary, next, "utf8");
  await fs.rename(temporary, dataFile);
  console.log("تم تحديث data/products.json بعد التحقق الكامل.");
}

main().catch(error => {
  console.error("Google Sheets sync failed:", error.message);
  process.exitCode = 1;
});
