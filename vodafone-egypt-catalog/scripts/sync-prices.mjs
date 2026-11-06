import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../data");
const API_BASE = "https://pricelens.store/api/v1/partner";
const API_KEY = process.env.PRICELENS_API_KEY;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UNMATCHED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_RETAILERS = ["b.tech", "2b", "raya", "tradeline"];
const COLOR_WORDS = [
  "glacier", "black", "white", "blue", "pink", "green", "orange",
  "silver", "graphite", "midnight", "starlight", "yellow", "purple",
  "natural", "desert", "cosmic", "lavender", "gray", "grey", "beige"
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value ?? "").toLowerCase()
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();

function textFields(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  const fields = [
    "brand", "title", "title_ar", "name", "name_ar", "product_name",
    "model", "variant", "variant_note", "storage", "ram", "memory",
    "specs", "specifications", "description", "listing_title"
  ];
  return fields.map(key => {
    const part = value[key];
    return part && typeof part === "object" ? JSON.stringify(part) : String(part ?? "");
  }).join(" ");
}

function parseSpecs(value) {
  const text = String(value ?? "");
  const ram = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:GB|جيجا)\s*(?:RAM|رام)/gi)]
    .map(match => Number(match[1]));
  const withoutRam = text.replace(/\d+(?:\.\d+)?\s*(?:GB|جيجا)\s*(?:RAM|رام)/gi, " ");
  const storage = [...withoutRam.matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)\b/gi)]
    .map(match => Number(match[1]) * (match[2].toUpperCase() === "TB" ? 1024 : 1));
  return { ram: [...new Set(ram)], storage: [...new Set(storage)] };
}

function requiredColors(variant) {
  const text = clean(variant);
  if (/\b(or|same|listed|either)\b/.test(text)) return [];
  return COLOR_WORDS.filter(color => new RegExp(`(^|\\s)${color}(?=\\s|$)`).test(text)).slice(0, 1);
}

function tokens(value) {
  return [...new Set(clean(value).split(/\s+/).filter(token => token.length > 1))];
}

function candidateMatches(product, candidate) {
  const candidateText = textFields(candidate);
  const candidateNormalized = clean(candidateText);
  const requiredTokens = tokens(`${product.brand || ""} ${product.name_ar || ""}`);
  if (!requiredTokens.length || requiredTokens.some(token =>
    !new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\\\]/g, "\\\\$&")}(?=\\s|$)`).test(candidateNormalized)
  )) return false;

  const wanted = parseSpecs(product.variant || "");
  const found = parseSpecs(candidateText);
  if (wanted.storage.length && !wanted.storage.every(value => found.storage.includes(value))) return false;
  if (wanted.ram.length && !wanted.ram.every(value => found.ram.includes(value))) return false;
  return true;
}

function collectCandidates(payload) {
  const found = [];
  const seen = new Set();
  const arrayKeys = new Set(["products", "results", "items", "matches", "data", "result", "hits"]);
  function visit(node, depth = 0) {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    const id = node.id || node.product_id || node.slug;
    const hasName = ["title", "title_ar", "name", "name_ar", "product_name"].some(key => node[key]);
    if (id && hasName) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(node);
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (arrayKeys.has(key) || key === "product") visit(value, depth + 1);
    }
  }
  visit(payload);
  return found;
}

function chooseCandidate(product, payload) {
  const candidates = collectCandidates(payload).filter(candidate => candidateMatches(product, candidate));
  if (candidates.length !== 1) return null;
  const candidate = candidates[0];
  const id = candidate.id || candidate.product_id || candidate.slug;
  return id ? { id: String(id), title: textFields(candidate).trim().slice(0, 240) } : null;
}

function retailerAllowed(name) {
  const value = clean(name).replace(/\s+/g, "");
  return ALLOWED_RETAILERS.some(store => value === store.replace(/\s+/g, "") ||
    value.startsWith(store.replace(/\s+/g, "")));
}

function offerMatchesVariant(product, offer) {
  const offerText = textFields(offer);
  const target = parseSpecs(product.variant || "");
  const actual = parseSpecs(offerText);
  if (target.storage.length && actual.storage.length &&
      !target.storage.every(value => actual.storage.includes(value))) return false;
  if (target.ram.length && actual.ram.length &&
      !target.ram.every(value => actual.ram.includes(value))) return false;

  const comparison = clean(offer.comparison_status || "");
  if (comparison && !["same core variant", "same_core_variant", "exact", "same"].includes(comparison)) return false;

  const colors = requiredColors(product.variant || "");
  const normalizedOffer = clean(offerText);
  for (const color of colors) {
    if (!new RegExp(`(^|\\s)${color}(?=\\s|$)`).test(normalizedOffer)) return false;
  }

  const condition = clean(offer.condition || "");
  if (condition && !/(^|\s)(new|brand new|جديد)(\s|$)/.test(condition)) return false;
  return true;
}

function findOfferArray(payload) {
  const keys = new Set(["offers", "listings", "market_offers", "retailer_offers"]);
  const matches = [];
  function visit(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node)) {
      if (keys.has(key) && Array.isArray(value) &&
          value.some(item => item && typeof item === "object" && ("price" in item))) {
        matches.push(value);
      } else if (value && typeof value === "object") {
        visit(value, depth + 1);
      }
    }
  }
  visit(payload);
  return matches.sort((a, b) => b.length - a.length)[0] || [];
}

function cairoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function asIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapOffer(product, offer, responseCurrency, nowMs) {
  const retailer = offer.retailer || offer.store || offer.merchant || "";
  if (!retailerAllowed(retailer) || !offerMatchesVariant(product, offer)) return null;

  const price = Number(offer.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  const currency = String(offer.currency || responseCurrency || "EGP").toUpperCase();
  if (currency !== "EGP") return null;

  const lastSeen = offer.last_seen || offer.checked_at || offer.updated_at;
  const timestamp = lastSeen ? new Date(lastSeen).getTime() : NaN;
  if (!Number.isFinite(timestamp) || nowMs - timestamp > MAX_AGE_MS || timestamp > nowMs + 5 * 60 * 1000) {
    return null;
  }

  const link = offer.link;
  if (typeof link !== "string" || !/^https:\/\//i.test(link)) return null;

  const seller = offer.seller ? String(offer.seller).trim() : "";
  const store = seller ? `${retailer} (seller: ${seller})` : String(retailer);
  const inStock = typeof offer.in_stock === "boolean"
    ? offer.in_stock
    : ["in_stock", "available", "limited"].includes(clean(offer.status).replace(/\s+/g, "_"))
      ? true
      : ["sold_out", "out_of_stock", "unavailable"].includes(clean(offer.status).replace(/\s+/g, "_"))
        ? false : null;

  return {
    store,
    price,
    status: inStock === true ? "in_stock" : inStock === false ? "sold_out" : "unknown",
    condition: offer.condition || "غير مؤكد",
    warranty: offer.warranty || "الضمان غير مؤكد",
    variant_note: offer.variant || offer.variant_note || offer.listing_title || "مطابقة الموديل والسعة عبر مصدر المقارنة؛ تحقق من تفاصيل اللون والضمان لدى البائع",
    comparison_status: "same_core_variant",
    checked_at: asIsoDate(lastSeen),
    observed_at: new Date(timestamp).toISOString(),
    source_url: link,
    retailer_url: typeof offer.store_url === "string" && /^https:\/\//i.test(offer.store_url)
      ? offer.store_url : null,
    source_provider: "PriceLens"
  };
}

async function readJson(fileName, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(dataDir, fileName), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(fileName, value) {
  const filePath = path.join(dataDir, fileName);
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temporaryPath, filePath);
}

async function apiGet(pathname) {
  const response = await fetch(API_BASE + pathname, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json"
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`PriceLens API ${response.status} على ${pathname}: ${body}`);
  }
  return response.json();
}

function addDailyObservations(history, comparisons, date) {
  history.daily_series = Array.isArray(history.daily_series) ? history.daily_series : [];
  const lookup = new Map(history.daily_series.map(series => [
    `${series.product_id}| ${series.store}`.replace("| ", "|"), series
  ]));

  for (const record of comparisons) {
    for (const offer of record.offers) {
      if (offer.status !== "in_stock") continue;
      const key = `${record.product_id}|${offer.store}`;
      let series = lookup.get(key);
      if (!series) {
        series = {
          product_id: record.product_id,
          store: offer.store,
          cadence: "daily",
          observations: [],
          note: "قراءة يومية من PriceLens؛ عرض نفس الموديل والسعة بعد فحص النسخة."
        };
        history.daily_series.push(series);
        lookup.set(key, series);
      }
      const observations = Array.isArray(series.observations) ? series.observations : [];
      const existing = observations.findIndex(point => point.date === date);
      const point = { date, price: offer.price, status: offer.status, source: "PriceLens" };
      if (existing >= 0) observations[existing] = point;
      else observations.push(point);
      observations.sort((a, b) => a.date.localeCompare(b.date));
      series.observations = observations;
    }
  }
}

async function runSelfTests() {
  const phone = {
    id: "iphone-18-pro-256-glacier",
    name_ar: "Apple iPhone 18 Pro",
    brand: "Apple",
    variant: "256GB — Glacier — 5G"
  };
  assert.deepEqual(parseSpecs("8GB RAM / 256GB"), { ram: [8], storage: [256] });
  assert.equal(candidateMatches(phone, {
    id: "provider-1", brand: "Apple", title: "Apple iPhone 18 Pro 256GB"
  }), true);
  assert.equal(candidateMatches(phone, {
    id: "provider-2", brand: "Apple", title: "Apple iPhone 18 Pro 128GB"
  }), false);
  assert.equal(retailerAllowed("B.TECH"), true);
  assert.equal(retailerAllowed("Noon"), false);
  const validOffer = {
    retailer: "B.TECH", price: 124850, currency: "EGP", in_stock: true,
    last_seen: new Date().toISOString(), link: "https://pricelens.store/api/v1/affiliate/go/test",
    variant_note: "256GB Glacier"
  };
  assert.equal(mapOffer(phone, validOffer, "EGP", Date.now())?.status, "in_stock");
  assert.equal(mapOffer(phone, { ...validOffer, variant_note: "256GB Blue" }, "EGP", Date.now()), null);
  assert.equal(mapOffer(phone, { ...validOffer, last_seen: "2020-01-01T00:00:00Z" }, "EGP", Date.now()), null);
  console.log("نجحت اختبارات مطابقة النسخ وعمر السعر ومصادر المتاجر.");
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTests();
    return;
  }
  if (!API_KEY) {
    throw new Error("مفتاح PRICELENS_API_KEY غير مضبوط في GitHub Secrets؛ لم يتم تعديل أي سعر.");
  }

  const [products, mappingFile, history] = await Promise.all([
    readJson("products.json", []),
    readJson("price-provider-map.json", { version: 1, products: {}, unresolved: {} }),
    readJson("price-history.json", { daily_series: [] })
  ]);
  if (!Array.isArray(products) || !products.length) throw new Error("كتالوج المنتجات غير صالح أو فارغ.");

  const now = new Date();
  const nowMs = now.getTime();
  const today = cairoDate(now);
  const mapping = mappingFile && typeof mappingFile === "object"
    ? mappingFile : { version: 1, products: {}, unresolved: {} };
  mapping.products = mapping.products || {};
  mapping.unresolved = mapping.unresolved || {};

  await apiGet("/whoami");
  let searched = 0;
  let mappedCount = 0;
  const comparisonRecords = [];
  const failures = [];

  for (const product of products) {
    let providerProduct = mapping.products[product.id];
    const unresolved = mapping.unresolved[product.id];
    const retryDue = !unresolved?.checked_at ||
      nowMs - new Date(unresolved.checked_at).getTime() >= UNMATCHED_RETRY_MS;

    if (!providerProduct && retryDue) {
      const query = encodeURIComponent(`${product.brand || ""} ${product.name_ar || ""} ${product.variant || ""}`.trim());
      const search = await apiGet(`/search?q=${query}`);
      searched += 1;
      const selected = chooseCandidate(product, search);
      if (selected) {
        providerProduct = {
          product_id: selected.id,
          title: selected.title,
          matched_at: now.toISOString()
        };
        mapping.products[product.id] = providerProduct;
        delete mapping.unresolved[product.id];
      } else {
        mapping.unresolved[product.id] = {
          checked_at: now.toISOString(),
          reason: "لم يظهر تطابق وحيد ودقيق للموديل والسعة/الذاكرة في بحث PriceLens."
        };
      }
      await sleep(250);
    }

    if (!providerProduct?.product_id) continue;
    mappedCount += 1;

    try {
      const payload = await apiGet(
        `/products/${encodeURIComponent(providerProduct.product_id)}/market?days=90`
      );
      const rawOffers = findOfferArray(payload);
      const responseCurrency = payload.currency || payload.market?.currency || "EGP";
      const offers = rawOffers
        .map(offer => mapOffer(product, offer, responseCurrency, nowMs))
        .filter(Boolean);

      const unique = new Map();
      for (const offer of offers) {
        const key = `${offer.store}|${offer.price}|${offer.source_url}`;
        unique.set(key, offer);
      }
      const acceptedOffers = [...unique.values()];
      if (acceptedOffers.length) {
        comparisonRecords.push({
          product_id: product.id,
          title: product.name_ar,
          variant: product.variant,
          as_of: today,
          provider_product_id: providerProduct.product_id,
          match_method: "مطابقة معرف المنتج لدى PriceLens مع العلامة والموديل والسعة/الذاكرة؛ اللون يُشترط عند ظهوره في تفاصيل العرض.",
          offers: acceptedOffers
        });
      }
    } catch (error) {
      failures.push(`${product.id}: ${error.message}`);
      break;
    }
    await sleep(250);
  }

  if (failures.length) {
    throw new Error("فشلت مزامنة منتج واحد أو أكثر؛ لم تُكتب لقطة أسعار جزئية. " + failures[0]);
  }

  const offersCount = comparisonRecords.reduce((sum, record) => sum + record.offers.length, 0);
  const providerData = {
    provider: "PriceLens",
    attribution: "Prices by PriceLens",
    attribution_url: "https://pricelens.store",
    currency: "EGP",
    refresh_cadence_hours: 3,
    stale_after_hours: 24,
    last_successful_sync: now.toISOString(),
    coverage: {
      catalog_products: products.length,
      mapped_products: mappedCount,
      products_with_current_offers: comparisonRecords.length,
      current_offers: offersCount,
      searches_performed: searched,
      included_retailers: ["B.TECH", "2B", "Raya", "Tradeline"]
    },
    comparisons: comparisonRecords
  };

  addDailyObservations(history, comparisonRecords, today);
  mapping.version = 1;
  mapping.updated_at = now.toISOString();

  await writeJson("price-provider-map.json", mapping);
  await writeJson("price-provider.json", providerData);
  await writeJson("price-history.json", history);

  console.log(`اكتملت مزامنة المنافسين من PriceLens: ${offersCount} عرضاً في ${comparisonRecords.length} منتجاً.`);
  console.log(`بحث جديد: ${searched} · منتجات مرتبطة: ${mappedCount} · التاريخ المحلي: ${today}`);
  console.log("لم يتم تعديل أسعار Vodafone Egypt الرسمية؛ تتطلب تغذية رسمية أو إذناً كتابياً.");
}

main().catch(error => {
  console.error("فشلت مزامنة الأسعار:", error.message);
  process.exitCode = 1;
});
