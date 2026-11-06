const pageUrl = process.env.VODAFONE_SMARTPHONES_URL || "https://eshop.vodafone.com.eg/ar/list?channelId=organicGoogle&c_id=DACS0367&c_medium=Organic&c_source=Google&c_type=Anonymous&categoryUrls=%2Fsmart-phones";
const headers = {
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "accept-language": "ar-EG,ar;q=0.9,en;q=0.8",
  "cache-control": "no-cache"
};
const fetchSafe = async (url) => {
  const response = await fetch(url, {headers, redirect:"follow"});
  const body = await response.text();
  return {response, body};
};
const {response:pageResponse,body:html}=await fetchSafe(pageUrl);
if(!pageResponse.ok) throw new Error("Vodafone category returned HTTP "+pageResponse.status);
const scriptPaths=[...html.matchAll(/<script\\b[^>]*>/gi)].map(m=>{
  const src=m[0].match(/\\bsrc\\s*=\\s*["']([^"']+)["']/i)?.[1];
  return src ? new URL(src,new URL(html.match(/<base[^>]+href=["']([^"']+)/i)?.[1]||"/",pageResponse.url)).href : null;
}).filter(Boolean);
const interesting = /api|graphql|product|category|catalog|search|listing|commerce|asset|image|media|pagination|plp|sku|stock|offer|price|variant/i;
const pathLike = /(?:https?:\\/\\/[^"'\\s<>]{8,300}|\\/[^"'\\s<>]{2,180})/g;
const jsQueue=[...new Set(scriptPaths)].slice(0,12);
const visited=new Set(), findings=[];
while(jsQueue.length && visited.size<18){
  const jsUrl=jsQueue.shift(); if(visited.has(jsUrl)) continue; visited.add(jsUrl);
  try {
    const {response,body}=await fetchSafe(jsUrl);
    if(!response.ok || !/(javascript|ecmascript|text\\/plain|octet-stream)/i.test(response.headers.get("content-type")||"")) continue;
    const sources=[...body.matchAll(/(?:import\\s*\\(\\s*|from\\s*|import\\s*)["']([^"']+\\.m?js(?:\\?[^"']*)?)["']/g)].map(m=>m[1]);
    for(const s of sources){try{const child=new URL(s,response.url).href;if(!visited.has(child)&&!jsQueue.includes(child))jsQueue.push(child);}catch{}}
    const strings=[...body.matchAll(/["']((?:\\\\.|[^"'\\\\]){2,240})["']/g)].map(m=>m[1].replace(/\\\\\\//g,"/"));
    const selected=[...new Set(strings.filter(s=>interesting.test(s)&&(/\\//.test(s)||/api|graphql|product|category|catalog|search/i.test(s))))].slice(0,100);
    const paths=[...new Set(body.match(pathLike)||[])].filter(s=>interesting.test(s)).slice(0,80);
    findings.push({url:response.url,status:response.status,bytes:body.length,contentType:response.headers.get("content-type"),selectedStrings:selected,paths});
  }catch(error){findings.push({url:jsUrl,error:error.message});}
}
console.log(JSON.stringify({
  categoryStatus:pageResponse.status, finalUrl:pageResponse.url, htmlBytes:html.length,
  scriptPaths, bundlesInspected:visited.size, findings
},null,2));
