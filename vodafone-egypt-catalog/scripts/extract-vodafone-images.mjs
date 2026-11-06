import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = path.join(root, "data", "products.json");
const products = JSON.parse(await fs.readFile(dataPath, "utf8"));
const PROBE_ONLY = process.argv.includes("--probe");
const APPLY = process.argv.includes("--apply");
const MAX_PAGES = Number(process.env.IMAGE_PROBE_LIMIT || (PROBE_ONLY ? 8 : 160));
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) out[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  return out;
}
function absoluteUrl(value, base) {
  if (!value || /^(data:|blob:|javascript:)/i.test(value)) return null;
  try {
    const u = new URL(value, base);
    if (u.protocol !== "https:") return null;
    u.hash = "";
    return u.href;
  } catch { return null; }
}
function usableImageUrl(value, base) {
  const url = absoluteUrl(value, base);
  if (!url) return null;
  const u = new URL(url);
  if (/logo|icon|sprite|placeholder|transparent|pixel|flag|payment|loading|avatar|badge/i.test(u.pathname)) return null;
  if (!/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(url) && !/(?:image|media|product|asset|upload)/i.test(u.pathname)) return null;
  return url;
}
function extractImageCandidates(html, pageUrl) {
  const candidates = [];
  const add = (value, source, score) => {
    const url = usableImageUrl(value, pageUrl);
    if (!url) return;
    candidates.push({url, source, score});
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (["og:image","og:image:url","twitter:image","twitter:image:src","image"].includes(key)) add(a.content, "meta:" + key, 100);
  }

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    if (String(a.rel || "").toLowerCase().includes("image_src")) add(a.href, "link:image_src", 90);
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const alt = a.alt || "";
    const value = a["data-zoom-image"] || a["data-large-image"] || a["data-src"] || a["data-original"] || a.src;
    if (!value) continue;
    const productLike = /product|device|phone|mobile|watch|tablet|speaker|tv|headphone|earbud|case|router/i.test(alt + " " + (a.class || "") + " " + (a.id || ""));
    add(value, productLike ? "img:product-like" : "img", productLike ? 80 : 25);
    if (a.srcset) {
      const entries = a.srcset.split(",").map(x => x.trim().split(/\s+/)[0]);
      for (const entry of entries) add(entry, "img:srcset", productLike ? 75 : 20);
    }
  }

  for (const tag of html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []) {
    const body = tag.replace(/^.*?>/s, "").replace(/<\/script>$/i, "");
    try {
      const parsed = JSON.parse(body);
      const visit = (node, depth = 0) => {
        if (!node || depth > 12) return;
        if (Array.isArray(node)) return node.forEach(x => visit(x, depth + 1));
        if (typeof node !== "object") return;
        if (node.image) {
          const values = Array.isArray(node.image) ? node.image : [node.image];
          for (const v of values) add(typeof v === "string" ? v : v?.url || v?.contentUrl, "jsonld:image", 95);
        }
        if (node["@graph"]) visit(node["@graph"], depth + 1);
        for (const [key, value] of Object.entries(node)) if (key !== "image") visit(value, depth + 1);
      };
      visit(parsed);
    } catch {}
  }

  const unique = new Map();
  for (const item of candidates.sort((a,b)=>b.score-a.score)) {
    if (!unique.has(item.url)) unique.set(item.url, item);
  }
  return [...unique.values()];
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "ar-EG,ar;q=0.9,en;q=0.8"
      }
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const type = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error("Not HTML: " + type);
    const html = await response.text();
    return {finalUrl:response.url || url, html};
  } finally {
    clearTimeout(timer);
  }
}

function normalizeText(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[أإآ]/g,"ا").replace(/[ىي]/g,"ي")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g," ").trim();
}
function scoreMatch(product, alt) {
  const p = normalizeText(product.name_ar + " " + product.brand);
  const a = normalizeText(alt);
  if (!a || !p) return 0;
  const parts = [...new Set(p.split(/\s+/).filter(x=>x.length>1))];
  const matched = parts.filter(token=>a.includes(token)).length;
  return matched / Math.max(1, parts.length);
}

const officialList = "https://eshop.vodafone.com.eg/ar/list?channelId=organicGoogle&c_id=DACS0367&c_medium=Organic&c_source=Google&c_type=Anonymous&categoryUrls=%2Fsmart-phones";
const targets = [];
const seen = new Set();
for (const p of products) {
  const url = p.product_url || (p.source_url?.includes("/prod/") ? p.source_url : null);
  if (url && !seen.has(url)) { seen.add(url); targets.push({url,products:[p]}); }
}
const phoneRows = products.filter(p=>p.category==="هواتف" && !p.image);
if (phoneRows.length) targets.unshift({url:officialList,products:phoneRows});

const selected = PROBE_ONLY ? targets.slice(0, MAX_PAGES) : targets.slice(0, MAX_PAGES);
const results = [];
for (let i=0;i<selected.length;i+=3) {
  const batch = selected.slice(i,i+3);
  const pages = await Promise.all(batch.map(async target=>{
    try {
      const fetched = await fetchPage(target.url);
      const images = extractImageCandidates(fetched.html,fetched.finalUrl);
      const imgTags = (fetched.html.match(/<img\b[^>]*>/gi)||[]).map(tag=>attrs(tag)).filter(a=>a.src||a["data-src"]);
      const title = (fetched.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1] || "";
      return {url:target.url,finalUrl:fetched.finalUrl,title:decodeHtml(title).trim(),status:"ok",htmlBytes:fetched.html.length,imageCandidates:images.length,topImages:images.slice(0,12),imgTags:imgTags.slice(0,20).map(a=>({alt:a.alt,src:a.src,dataSrc:a["data-src"],class:a.class})),html:fetched.html,target};
    } catch(error) {
      return {url:target.url,status:"error",error:error.message,target};
    }
  }));
  results.push(...pages);
  for (const item of pages) {
    if (item.status==="ok") {
      const altPairs=(item.imgTags||[]).map(a=>({alt:a.alt||"",url:a.src||a.dataSrc||"",score:0})).map(x=>({...x,score:Math.max(...item.target.products.map(p=>scoreMatch(p,x.alt)),0)}));
      console.log(JSON.stringify({
        page:item.url,status:item.status,title:item.title,bytes:item.htmlBytes,
        candidates:item.imageCandidates,top:item.topImages.slice(0,8),
        likelyMatches:altPairs.filter(x=>x.score>=0.6).slice(0,8)
      }));
    } else console.log(JSON.stringify({page:item.url,status:item.status,error:item.error}));
  }
}

if (APPLY) {
  const byId = new Map();
  for (const result of results) {
    if (result.status!=="ok") continue;
    const listUrl = result.url===officialList;
    if (listUrl) {
      for (const attrs of result.imgTags) {
        const alt=attrs.alt||"";
        const image=usableImageUrl(attrs["data-zoom-image"]||attrs["data-large-image"]||attrs["data-src"]||attrs.src,result.finalUrl);
        if (!image) continue;
        for (const p of result.target.products) {
          const score=scoreMatch(p,alt);
          if(score>=0.65) {
            const previous=byId.get(p.id);
            if(!previous||score>previous.score) byId.set(p.id,{image,score,source:result.finalUrl,alt});
          }
        }
      }
    } else if (result.target.products.length===1) {
      const p=result.target.products[0];
      const best=result.topImages?.[0];
      if(best && best.score>=90) byId.set(p.id,{image:best.url,score:best.score/100,source:result.finalUrl,alt:best.source});
    }
  }
  let changed=0;
  for (const p of products) {
    const item=byId.get(p.id);
    if(!p.image&&item) {
      p.image=item.image;
      p.image_credit="Vodafone Egypt product page";
      p.source_note=[p.source_note||"", "Image extracted from official Vodafone product page: "+item.source].filter(Boolean).join(" ");
      changed++;
    }
  }
  await fs.writeFile(dataPath,JSON.stringify(products,null,2)+"\n","utf8");
  console.log(JSON.stringify({applied:changed,total:products.length,remaining:products.filter(p=>!p.image).length}));
} else if (!PROBE_ONLY) {
  console.log("Probe complete. Re-run with --apply only after reviewing the source URLs.");
}
