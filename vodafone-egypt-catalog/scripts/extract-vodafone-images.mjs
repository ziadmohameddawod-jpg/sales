import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data", "products.json");
const products = JSON.parse(await fs.readFile(dataPath, "utf8"));
const PROBE_ONLY = process.argv.includes("--probe") || process.argv.includes("--dry-run");
const APPLY = process.argv.includes("--apply");
const LIMIT = Math.max(1, Number(process.env.IMAGE_PROBE_LIMIT || 160));
const USER_AGENT = "SouqScan-Official-Image-Checker/1.0 (+https://ziadmohameddawod-jpg.github.io/sales/)";

const ALIASES = new Map([
  ["أ","ا"], ["إ","ا"], ["آ","ا"], ["ى","ي"], ["ئ","ي"],
  ["ايفون","iphone"], ["ابل","apple"], ["شاومي","xiaomi"], ["ريدمي","redmi"],
  ["ريلمي","realme"], ["سامسونج","samsung"], ["جالكسي","galaxy"], ["جالاكسي","galaxy"],
  ["برو","pro"], ["ماكس","max"], ["ألترا","ultra"], ["الترا","ultra"],
  ["لايت","lite"], ["بلس","plus"], ["اير","air"], ["هونر","honor"],
  ["انفينيكس","infinix"], ["فيفو","vivo"], ["تكنو","tecno"], ["سمارت","smart"],
  ["نوت","note"], ["إيدج","edge"], ["ايدج","edge"], ["الخامس","5g"], ["الرابع","4g"]
]);
const IGNORE = new Set([
  "bundle","with","buds","bud","headphones","headphone","speaker","portable",
  "smartphone","phone","device","mobile","ram","storage","gb","tb","dual","sim",
  "and","the","vodafone","egypt","سماعات","هدية","جراب","ساعة","مروحة","مع"
]);
const MODEL_SUFFIXES = new Set(["max","mini","plus","ultra","pro","lite","fe","air","edge","neo","fold","flip","e"]);
const CAPACITIES = new Set(["64","128","256","512","1024"]);

function normalizeTokens(value) {
  let text = String(value || "").normalize("NFKC").toLowerCase();
  for (const [from, to] of ALIASES) text = text.replaceAll(from, to);
  return text.split(/[^a-z0-9]+/).filter(Boolean);
}
function modelTokens(product) {
  const brand = new Set(normalizeTokens(product.brand));
  const name = String(product.name_ar || "");
  const tokens = normalizeTokens(name).filter(token => !brand.has(token) && !IGNORE.has(token));
  if (/\+\s*$/.test(name) && !tokens.includes("plus")) tokens.push("plus");
  return [...new Set(tokens)];
}
function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&#x2F;/gi, "/").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function attributes(tag) {
  const result = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = pattern.exec(tag))) result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return result;
}
function metaValue(html, names) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attributes(tag);
    const key = String(a.property || a.name || a.itemprop || "").toLowerCase();
    if (names.includes(key) && a.content) return a.content;
  }
  return "";
}
function imageUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.hostname !== "eshop.vodafone.com.eg") return null;
    if (/logo|icon|sprite|placeholder|transparent|pixel|flag|payment|loading|avatar|badge/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal, redirect: "follow",
      headers: {"user-agent": USER_AGENT, "accept-language": "ar-EG,ar;q=0.9,en;q=0.8"}
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) {
      throw new Error("الرابط لم يرجع صفحة HTML");
    }
    return {html: await response.text(), finalUrl: response.url || url};
  } finally { clearTimeout(timer); }
}
async function imageIsLive(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    let response = await fetch(url, {method:"HEAD", signal:controller.signal, redirect:"follow", headers:{"user-agent":USER_AGENT}});
    if (!response.ok || !/^image\//i.test(response.headers.get("content-type") || "")) {
      response = await fetch(url, {method:"GET", signal:controller.signal, redirect:"follow", headers:{"user-agent":USER_AGENT, range:"bytes=0-0"}});
    }
    const valid = response.ok && /^image\//i.test(response.headers.get("content-type") || "") &&
      new URL(response.url || url).hostname === "eshop.vodafone.com.eg";
    try { await response.body?.cancel(); } catch {}
    return valid;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
function capacityTokens(value) {
  return normalizeTokens(value).filter(token => CAPACITIES.has(token));
}
function matchProduct(product, title, image) {
  const expected = modelTokens(product);
  const actual = normalizeTokens(title);
  const missing = expected.filter(token => !actual.includes(token));
  const extraSuffix = actual.filter(token => MODEL_SUFFIXES.has(token) && !expected.includes(token));
  if (missing.length || extraSuffix.length) return {ok:false, reason:"model_mismatch", missing, extraSuffix};

  const pageIsBundle = /bundle|باقة/i.test(title);
  const productIsBundle = /bundle|باقة|هدية|سماعة|ساعة|جراب|مروحة/i.test(product.name_ar || "");
  if (pageIsBundle && !productIsBundle) return {ok:false, reason:"bundle_mismatch"};

  const wantedCapacity = capacityTokens(product.variant).at(-1);
  const titleCapacities = capacityTokens(title);
  const imageName = decodeURIComponent(new URL(image).pathname.split("/").pop() || "");
  const imageCapacities = capacityTokens(imageName);
  if (wantedCapacity && titleCapacities.length && !titleCapacities.includes(wantedCapacity)) {
    return {ok:false, reason:"page_capacity_mismatch"};
  }
  if (wantedCapacity && imageCapacities.length && !imageCapacities.includes(wantedCapacity)) {
    return {ok:false, reason:"image_capacity_mismatch"};
  }
  return {ok:true};
}

const uniqueTargets = new Map();
for (const product of products) {
  if (product.image || !product.product_url) continue;
  let url;
  try {
    url = new URL(product.product_url);
    if (url.protocol !== "https:" || !["eshop.vodafone.com.eg","web.vodafone.com.eg"].includes(url.hostname)) continue;
    if (!url.pathname.includes("/prod/")) continue;
    url.hash = "";
  } catch { continue; }
  const key = url.href;
  if (!uniqueTargets.has(key)) uniqueTargets.set(key, {url:key, products:[]});
  uniqueTargets.get(key).products.push(product);
}
const targets = [...uniqueTargets.values()].slice(0, LIMIT);
const approved = [];
const rejected = [];
for (let i = 0; i < targets.length; i += 3) {
  const batch = await Promise.all(targets.slice(i, i + 3).map(async target => {
    try {
      const page = await fetchText(target.url);
      const titleMatch = page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const title = decodeHtml(titleMatch?.[1] || "").replace(/\s+/g, " ").trim();
      const rawImage = metaValue(page.html, ["og:image","og:image:url","twitter:image","twitter:image:src"]);
      const image = imageUrl(rawImage, page.finalUrl);
      if (!title || !image) return {target, title, reason:"missing_product_title_or_official_image"};
      const imageLive = await imageIsLive(image);
      if (!imageLive) return {target, title, image, reason:"image_not_live"};
      const matched = target.products.filter(product => matchProduct(product, title, image).ok);
      const declined = target.products.filter(product => !matchProduct(product, title, image).ok);
      return {target, title, image, matched, declined};
    } catch (error) {
      return {target, reason:error.message};
    }
  }));
  for (const result of batch) {
    if (result.matched?.length) {
      for (const product of result.matched) approved.push({id:product.id, image:result.image, page:result.target.url, title:result.title});
    }
    if (result.declined?.length || result.reason) {
      rejected.push({url:result.target.url, ids:(result.declined || result.target.products).map(p=>p.id), reason:result.reason || "product_title_or_variant_mismatch"});
    }
    console.log(JSON.stringify({
      page:result.target.url, title:result.title || "", accepted:(result.matched || []).map(p=>p.id),
      rejected:(result.declined || []).map(p=>p.id), reason:result.reason || ""
    }));
  }
}
if (APPLY) {
  const byId = new Map(approved.map(item => [item.id, item]));
  let updated = 0;
  for (const product of products) {
    const item = byId.get(product.id);
    if (!item || product.image) continue;
    product.image = item.image;
    product.image_credit = "Vodafone Egypt eShop";
    product.source_note = [product.source_note || "", "صورة من صفحة فودافون الرسمية: " + item.page]
      .filter(Boolean).join(" · ");
    updated += 1;
  }
  if (updated) await fs.writeFile(dataPath, JSON.stringify(products, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({updated, remainingImages:products.filter(p=>!p.image).length, rejected:rejected.length}));
} else {
  console.log(JSON.stringify({dryRun:true, approved:approved.length, remainingImages:products.filter(p=>!p.image).length, rejected:rejected.length}));
}
