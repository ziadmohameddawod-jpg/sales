import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const errors = [];
const warnings = [];

function readJson(name) {
  const file = path.join(dataDir, name);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`تعذر قراءة ${name}: ${error.message}`);
    return null;
  }
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPositivePrice(value) {
  return value !== null && value !== undefined && value !== "" &&
    Number.isFinite(Number(value)) && Number(value) > 0;
}

function validateUrl(value, label, required = false) {
  if (!value) {
    if (required) errors.push(`${label}: رابط المصدر مطلوب.`);
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") errors.push(`${label}: يجب أن يكون الرابط HTTPS.`);
  } catch {
    errors.push(`${label}: رابط غير صالح (${value}).`);
  }
}

const products = readJson("products.json");
const market = readJson("market.json");
const comparisons = readJson("market-comparisons.json");
const history = readJson("price-history.json");
let provider = null;
try {
  provider = JSON.parse(fs.readFileSync(path.join(dataDir, "price-provider.json"), "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") errors.push(`تعذر قراءة price-provider.json: ${error.message}`);
}

if (Array.isArray(products)) {
  const ids = new Set();
  for (const [index, product] of products.entries()) {
    const label = `products.json[${index}]`;
    if (!product || typeof product !== "object") {
      errors.push(`${label}: سجل المنتج غير صالح.`);
      continue;
    }
    if (!product.id || ids.has(String(product.id))) errors.push(`${label}: معرّف المنتج مفقود أو مكرر.`);
    ids.add(String(product.id));
    for (const field of ["name_ar", "brand", "category", "variant"]) {
      if (typeof product[field] !== "string" || !product[field].trim()) {
        errors.push(`${label}: الحقل ${field} مطلوب.`);
      }
    }
    if (!isPositivePrice(product.price)) errors.push(`${label}: السعر يجب أن يكون رقماً موجباً.`);
    if (product.currency && product.currency !== "EGP") errors.push(`${label}: العملة غير متوقعة (${product.currency}).`);
    if (product.source_checked_at && !isDate(product.source_checked_at)) {
      errors.push(`${label}: تاريخ آخر فحص غير صالح.`);
    }
    validateUrl(product.product_url, `${label}.product_url`);
    validateUrl(product.source_url, `${label}.source_url`);
    validateUrl(product.image, `${label}.image`);
  }
} else if (products !== null) {
  errors.push("products.json: المتوقع مصفوفة منتجات.");
}

function validateOfferList(records, listField, fileName) {
  if (!Array.isArray(records)) {
    errors.push(`${fileName}: المتوقع مصفوفة comparisons.`);
    return 0;
  }
  let offerCount = 0;
  for (const [index, record] of records.entries()) {
    const label = `${fileName}.comparisons[${index}]`;
    if (!record || typeof record !== "object") {
      errors.push(`${label}: سجل المقارنة غير صالح.`);
      continue;
    }
    const offers = record[listField];
    if (!Array.isArray(offers)) {
      errors.push(`${label}.${listField}: المتوقع مصفوفة.`);
      continue;
    }
    for (const [offerIndex, offer] of offers.entries()) {
      offerCount += 1;
      const offerLabel = `${label}.${listField}[${offerIndex}]`;
      if (!offer || typeof offer !== "object") {
        errors.push(`${offerLabel}: العرض غير صالح.`);
        continue;
      }
      if (!(offer.store || offer.seller)) errors.push(`${offerLabel}: اسم المتجر/البائع مطلوب.`);
      if (!isPositivePrice(offer.price)) errors.push(`${offerLabel}: السعر يجب أن يكون موجباً.`);
      const date = offer.checked_at || offer.as_of || record.as_of || record.checked_at;
      if (date && !isDate(date)) warnings.push(`${offerLabel}: تاريخ الرصد غير قياسي.`);
      validateUrl(offer.source_url || offer.url, `${offerLabel}.source_url`);
    }
  }
  return offerCount;
}

let marketOfferCount = 0;
if (market) {
  marketOfferCount = validateOfferList(market.comparisons, "market_offers", "market.json");
}
let comparisonOfferCount = 0;
if (comparisons) {
  comparisonOfferCount = validateOfferList(comparisons.comparisons, "offers", "market-comparisons.json");
}

if (provider) {
  if (provider.provider !== "PriceLens") errors.push("price-provider.json: مزود البيانات غير معروف.");
  if (provider.currency !== "EGP") errors.push("price-provider.json: العملة يجب أن تكون EGP.");
  if (provider.last_successful_sync && !Number.isFinite(Date.parse(provider.last_successful_sync))) {
    errors.push("price-provider.json: توقيت آخر مزامنة غير صالح.");
  }
  if (!Array.isArray(provider.comparisons)) errors.push("price-provider.json: comparisons يجب أن تكون مصفوفة.");
  else {
    const providerIds = new Set();
    for (const [index, record] of provider.comparisons.entries()) {
      const label = `price-provider.json.comparisons[${index}]`;
      if (!record.product_id || providerIds.has(String(record.product_id))) errors.push(`${label}: معرّف المنتج مفقود أو مكرر.`);
      providerIds.add(String(record.product_id));
      if (record.provider_sync !== true) errors.push(`${label}: علامة المزامنة مفقودة.`);
      if (!Array.isArray(record.offers)) errors.push(`${label}: offers يجب أن تكون مصفوفة.`);
      else for (const [offerIndex, offer] of record.offers.entries()) {
        const offerLabel = `${label}.offers[${offerIndex}]`;
        if (!isPositivePrice(offer.price)) errors.push(`${offerLabel}: السعر يجب أن يكون موجباً.`);
        if (!offer.source_url || !/^https:\/\//i.test(offer.source_url)) errors.push(`${offerLabel}: رابط PriceLens الأصلي مطلوب.`);
        if (offer.source_provider !== "PriceLens") errors.push(`${offerLabel}: اسم مزود المصدر غير صحيح.`);
      }
    }
  }
}

let weeklyObservationCount = 0;
let dailyObservationCount = 0;
if (history && typeof history === "object") {
  if (!Array.isArray(history.series)) errors.push("price-history.json: series يجب أن تكون مصفوفة.");
  else {
    for (const [index, series] of history.series.entries()) {
      for (const [pointIndex, point] of (series.observations || []).entries()) {
        weeklyObservationCount += 1;
        if (!isDate(point.date)) errors.push(`price-history.json.series[${index}].observations[${pointIndex}]: تاريخ غير صالح.`);
        if (!isPositivePrice(point.price)) errors.push(`price-history.json.series[${index}].observations[${pointIndex}]: سعر غير صالح.`);
      }
    }
  }
  if (!Array.isArray(history.daily_series)) errors.push("price-history.json: daily_series يجب أن تكون مصفوفة.");
  else {
    const seen = new Set();
    for (const [seriesIndex, series] of history.daily_series.entries()) {
      const seriesKey = `${series.product_id || ""}|${series.store || ""}`;
      for (const [pointIndex, point] of (series.observations || []).entries()) {
        dailyObservationCount += 1;
        const label = `price-history.json.daily_series[${seriesIndex}].observations[${pointIndex}]`;
        if (!isDate(point.date)) errors.push(`${label}: تاريخ غير صالح.`);
        if (!isPositivePrice(point.price)) errors.push(`${label}: سعر غير صالح.`);
        const key = `${seriesKey}|${point.date}`;
        if (seen.has(key)) errors.push(`${label}: توجد قراءة يومية مكررة لنفس المنتج والمتجر والتاريخ.`);
        seen.add(key);
      }
    }
  }
  const required = Number(history.short_term_forecast_requirements?.min_daily_observations || 0);
  if (required < 1) errors.push("price-history.json: حد القراءات اليومية المطلوبة للتوقع يجب أن يكون موجباً.");
  if (!dailyObservationCount) warnings.push("لا توجد قراءات يومية بعد؛ سيظل توقع 48 ساعة معطلاً حتى جمع بيانات فعلية.");
  if (Array.isArray(products) && products.length) {
    const missingImages = products.filter(product => !product.image).length;
    const missingProductUrls = products.filter(product => !product.product_url).length;
    if (missingImages) warnings.push(`صور ناقصة: ${missingImages} منتجاً.`);
    if (missingProductUrls) warnings.push(`روابط منتجات مباشرة ناقصة: ${missingProductUrls} منتجاً.`);
  }
}

if (errors.length) {
  console.error("\\nفشل فحص بيانات SouqScan:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("نجح فحص بنية بيانات SouqScan.");
  const imageCount = Array.isArray(products) ? products.filter(product => !!product.image).length : 0;
  const productUrlCount = Array.isArray(products) ? products.filter(product => !!product.product_url).length : 0;
  console.log(`المنتجات: ${Array.isArray(products) ? products.length : 0}`);
  console.log(`صور المنتجات: ${imageCount}/${Array.isArray(products) ? products.length : 0}`);
  console.log(`روابط المنتجات المباشرة: ${productUrlCount}/${Array.isArray(products) ? products.length : 0}`);
  console.log(`عروض المقارنة: ${comparisonOfferCount + marketOfferCount}`);
  console.log(`قراءات تاريخية أسبوعية: ${weeklyObservationCount}`);
  console.log(`قراءات يومية: ${dailyObservationCount}`);
}
for (const warning of warnings) console.warn(`تحذير: ${warning}`);
