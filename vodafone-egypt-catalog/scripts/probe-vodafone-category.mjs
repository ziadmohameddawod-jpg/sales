const url = process.env.VODAFONE_SMARTPHONES_URL || "https://eshop.vodafone.com.eg/ar/list?channelId=organicGoogle&c_id=DACS0367&c_medium=Organic&c_source=Google&c_type=Anonymous&categoryUrls=%2Fsmart-phones";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ar-EG,ar;q=0.9,en;q=0.8",
  "cache-control": "no-cache"
};
const response = await fetch(url, {headers, redirect:"follow"});
const html = await response.text();
const clean = value => String(value || "").replace(/<script\\b[\\s\\S]*?<\\/script>/gi, " ")
  .replace(/<style\\b[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'").replace(/\\s+/g," ").trim();
const attrs = tag => {
  const out = {};
  for (const m of tag.matchAll(/([\\w:-]+)\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
};
const links = [];
for (const m of html.matchAll(/<a\\b[^>]*>[\\s\\S]*?<\\/a>/gi)) {
  const tag = m[0].slice(0, m[0].indexOf(">") + 1);
  const a = attrs(tag);
  if (!/\\/prod\\//i.test(a.href || "")) continue;
  const imgs = [...m[0].matchAll(/<img\\b[^>]*>/gi)].map(x => {
    const i = attrs(x[0]);
    return {alt:i.alt||"",src:i.src||"",dataSrc:i["data-src"]||i["data-lazy-src"]||"",srcset:i.srcset||"",class:i.class||""};
  });
  links.push({href:a.href, text:clean(m[0]).slice(0,260), imgs});
}
const images = [...html.matchAll(/<img\\b[^>]*>/gi)].map(m => {
  const a=attrs(m[0]); return {alt:a.alt||"",src:a.src||"",dataSrc:a["data-src"]||a["data-lazy-src"]||"",srcset:a.srcset||"",class:a.class||""};
});
const scripts = [...html.matchAll(/<script\\b[^>]*>/gi)].map(m=>attrs(m[0]).src).filter(Boolean);
const title = html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1]?.replace(/<[^>]+>/g,"").trim() || "";
console.log(JSON.stringify({
  status:response.status, finalUrl:response.url, contentType:response.headers.get("content-type"),
  title, htmlLength:html.length, productAnchors:links.length, imageTags:images.length,
  scriptSources:scripts.slice(0,30), links:links.slice(0,80), sampleImages:images.slice(0,40),
  htmlStart:links.length===0 ? html.slice(0,1800) : undefined
},null,2));
