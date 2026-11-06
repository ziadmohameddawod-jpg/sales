import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const dataDir=path.resolve(here,"../data");
const today=(()=>{
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return values.year+"-"+values.month+"-"+values.day;
})();
const read=async name=>JSON.parse(await fs.readFile(path.join(dataDir,name),"utf8"));
const write=async(name,value)=>{
  const target=path.join(dataDir,name),temporary=target+".tmp";
  await fs.writeFile(temporary,JSON.stringify(value,null,2)+"\n","utf8");
  await fs.rename(temporary,target);
};
const products=await read("products.json");
const history=await read("price-history.json");
history.daily_series=Array.isArray(history.daily_series)?history.daily_series:[];
const byKey=new Map(history.daily_series.map(series=>[String(series.product_id)+"|"+String(series.store),series]));
let added=0,updated=0,skipped=0;
for(const product of products){
  const price=Number(product.price);
  if(!product.id||!Number.isFinite(price)||price<=0||!/^\d{4}-\d{2}-\d{2}$/.test(product.source_checked_at||"")||product.source_checked_at!==today){
    skipped++;continue;
  }
  if(!product.source_url&&!product.product_url){skipped++;continue;}
  const key=String(product.id)+"|Vodafone Egypt";
  let series=byKey.get(key);
  if(!series){
    series={product_id:product.id,store:"Vodafone Egypt",cadence:"daily",observations:[],note:"لقطة يومية من كتالوج Vodafone Egypt؛ تُسجل فقط عندما يكون تاريخ فحص المنتج هو تاريخ اليوم في القاهرة."};
    history.daily_series.push(series);byKey.set(key,series);
  }
  const observations=Array.isArray(series.observations)?series.observations:[];
  const index=observations.findIndex(point=>point.date===today);
  const point={date:today,price,status:product.status||"unknown",source:"Vodafone Egypt catalogue",source_url:product.source_url||product.product_url};
  if(index>=0){observations[index]=point;updated++;}
  else{observations.push(point);added++;}
  observations.sort((a,b)=>a.date.localeCompare(b.date));
  series.observations=observations;
}
await write("price-history.json",history);
console.log(JSON.stringify({date:today,products:products.length,dailySeries:history.daily_series.length,added,updated,skipped}));
