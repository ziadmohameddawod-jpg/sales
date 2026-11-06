const $ = (id) => document.getElementById(id);
const state = {
  products: [], category: "الكل", query: "", availableOnly: false,
  sort: "featured", store: "", date: "", min: "", max: ""
};
let marketRecords = [];
const FALLBACK_IMAGE = {
  "هواتف": brand => brand === "Samsung" ? '<div class="device-art samsung"><i class="lens"></i></div>' : '<div class="device-art"><i class="lens"></i></div>',
  "راوتر وإنترنت": () => '<div class="router-art"></div>',
  "إكسسوارات": () => '<div class="generic-art">⌁</div>'
};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat("ar-EG", {maximumFractionDigits: 0}).format(Number(value)) : "—";
const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim();
function formatDate(value) {
  if (!value) return "تاريخ اللقطة غير محدد";
  const date = new Date(value + "T00:00:00");
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ar-EG", {day:"numeric",month:"short",year:"numeric"}).format(date);
}
async function getJson(path) {
  const response = await fetch(path + "?v=" + Date.now(), {cache:"no-store"});
  if (!response.ok) throw new Error("تعذر تحميل " + path);
  return response.json();
}
function productRecords(product) {
  const productName = normalize(product.name_ar);
  return marketRecords.filter(record => {
    if (String(record.product_id || record.id || "") === String(product.id)) return true;
    const recordName = normalize(record.title || record.name);
    return !!recordName && (recordName === productName || recordName.includes(productName) || productName.includes(recordName));
  });
}
function normalizeStatus(status) {
  const value=String(status||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
  if(["in","in_stock","instock","available","available_now","متاح","متوفر"].includes(value))return "in_stock";
  if(["out","sold_out","out_of_stock","unavailable","نفد","غير_متوفر"].includes(value))return "sold_out";
  if(["limited","low_stock","few_left","محدود"].includes(value))return "limited";
  return "unknown";
}
function offersFor(product) {
  const entries = [];
  productRecords(product).forEach(record => {
    const snapshotDate = record.as_of || record.checked_at || "";
    (record.offers || record.market_offers || []).forEach(offer => {
      const store = offer.store || offer.seller;
      if (store && Number(offer.price) > 0) entries.push({
        store, price:Number(offer.price), status:normalizeStatus(offer.status),
        date:offer.checked_at || offer.as_of || snapshotDate,
        source:record.tracker_source || record.source_url || "",
        warranty:offer.warranty || "الضمان غير مؤكد"
      });
    });
  });
  return entries;
}
function currentListing(product) {
  if (!state.store || state.store === "Vodafone Egypt") return {
    store:"Vodafone Egypt", price:Number(product.price), status:normalizeStatus(product.status),
    date:product.source_checked_at || "", source:product.source_url || product.product_url || ""
  };
  const offers = offersFor(product).filter(offer => offer.store === state.store);
  offers.sort((a,b) => (a.status === "in_stock" ? -1 : 0) - (b.status === "in_stock" ? -1 : 0) || a.price-b.price);
  return offers[0] || null;
}
function allStores() {
  return [...new Set(["Vodafone Egypt", ...marketRecords.flatMap(r => (r.offers || r.market_offers || []).map(o => o.store || o.seller)).filter(Boolean)])].sort((a,b)=>a.localeCompare(b));
}
function allDates() {
  const dates = new Set(state.products.map(p=>p.source_checked_at).filter(Boolean));
  marketRecords.forEach(r => {
    if (r.as_of || r.checked_at) dates.add(r.as_of || r.checked_at);
    (r.offers || r.market_offers || []).forEach(o => { if (o.checked_at || o.as_of) dates.add(o.checked_at || o.as_of); });
  });
  return [...dates].sort((a,b)=>b.localeCompare(a));
}
function available(listing) { return !!listing && listing.status === "in_stock"; }
function discount(product) {
  const old = Number(product.old_price), now = Number(product.price);
  return old > now && now > 0 ? {amount:old-now, percent:(old-now)/old*100} : {amount:0,percent:0};
}
function valueScore(product) {
  const recordedDiscount = discount(product).percent;
  return (recordedDiscount || 0) + (available(currentListing(product)) ? 8 : 0);
}
function applyFilters() {
  let items = state.products.filter(product => {
    const text = normalize([product.name_ar,product.brand,product.category,product.variant,product.description].join(" "));
    const listing = currentListing(product);
    const dateMatch = !state.date || listing?.date === state.date;
    const price = listing ? Number(listing.price) : NaN;
    return (state.category === "الكل" || product.category === state.category) &&
      (!state.query || text.includes(normalize(state.query))) &&
      (!state.availableOnly || available(listing)) &&
      (!state.store || !!listing) && dateMatch &&
      (!state.min || price >= Number(state.min)) && (!state.max || price <= Number(state.max));
  });
  const priceOf = product => Number(currentListing(product)?.price) || Infinity;
  if (state.sort === "price-asc") items.sort((a,b)=>priceOf(a)-priceOf(b));
  if (state.sort === "price-desc") items.sort((a,b)=>priceOf(b)-priceOf(a));
  if (state.sort === "savings") items.sort((a,b)=>discount(b).amount-discount(a).amount);
  if (state.sort === "value") items.sort((a,b)=>valueScore(b)-valueScore(a) || priceOf(a)-priceOf(b));
  if (state.sort === "name") items.sort((a,b)=>a.name_ar.localeCompare(b.name_ar,"ar"));
  return items;
}
function visualFallback(category, brand) {
  const renderer = FALLBACK_IMAGE[category] || (()=>'<div class="generic-art">◇</div>');
  return renderer(brand || "");
}
function renderBestPicks(items) {
  const availableItems = items.filter(product=>available(currentListing(product)));
  const byPrice = (availableItems.length ? availableItems : items).slice().sort((a,b)=>Number(currentListing(a)?.price)-Number(currentListing(b)?.price));
  const lowest = byPrice[0];
  const savings = items.filter(product=>discount(product).amount>0).slice().sort((a,b)=>discount(b).amount-discount(a).amount)[0];
  const value = items.slice().sort((a,b)=>valueScore(b)-valueScore(a) || Number(currentListing(a)?.price)-Number(currentListing(b)?.price))[0];
  const picks = [
    {product:lowest,label:"أقل سعر ضمن النتائج",detail:lowest?money(currentListing(lowest).price)+" جنيه"+(availableItems.length?" · توفر مؤكد في اللقطة":" · لا يوجد مخزون مؤكد في النتائج"):"لا توجد نتيجة",kind:"lowest"},
    {product:savings,label:"أكبر توفير مُسجل",detail:savings?"وفر "+money(discount(savings).amount)+" جنيه مقارنة بالسعر السابق":"لا توجد أسعار سابقة مسجلة",kind:"saving"},
    {product:value,label:"أفضل قيمة سعرية",detail:value?(discount(value).percent?discount(value).percent.toFixed(0)+"% خصم مسجل":"متاح بسعر "+money(currentListing(value)?.price)+" جنيه")+" · مؤشر سعر وتوفر فقط":"—",kind:"value"}
  ];
  $("bestPicks").innerHTML = picks.map(pick => pick.product ? '<button class="pick-card '+pick.kind+'" data-details="'+escapeHtml(pick.product.id)+'"><span>'+pick.label+'</span><b>'+escapeHtml(pick.product.name_ar)+'</b><small>'+escapeHtml(pick.detail)+'</small></button>' : '<div class="pick-card muted"><span>'+pick.label+'</span><b>لا توجد بيانات كافية</b><small>'+escapeHtml(pick.detail)+'</small></div>').join("");
  $("bestPicks").querySelectorAll("[data-details]").forEach(button=>button.addEventListener("click",()=>openDetails(button.dataset.details)));
}
function card(product, badges) {
  const listing = currentListing(product);
  const label = listing?.store || "Vodafone Egypt";
  const status = listing?.status || product.status || "unknown";
  const statusText = ["out","sold_out"].includes(status) ? "آخر سعر مرصود" : status === "limited" ? "مخزون محدود حسب اللقطة" : "تحقق من التوفر";
  const availabilityText = status === "in_stock" ? "متاح وقت اللقطة لدى "+label
    : status === "sold_out" ? "غير متاح وقت اللقطة لدى "+label
    : status === "limited" ? "مخزون محدود حسب اللقطة لدى "+label
    : "التوفر غير مؤكد لدى "+label;
  const visual = product.image
    ? '<img src="'+escapeHtml(product.image)+'" alt="'+escapeHtml(product.name_ar)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false"><div class="fallback-holder" hidden>'+visualFallback(product.category,product.brand)+'</div>'
    : visualFallback(product.category,product.brand);
  const storeCaption = state.store && state.store !== "Vodafone Egypt" ? 'سعر مرصود لدى '+escapeHtml(label) : 'سعر مرجعي لدى Vodafone Egypt';
  const tags = badges.map(badge=>'<span class="recommend-badge '+badge.kind+'">'+badge.text+'</span>').join("");
  return '<article class="product-card"><div class="product-media"><span class="product-badge '+escapeHtml(status)+'">'+escapeHtml(statusText)+'</span><div class="recommend-badges">'+tags+'</div>'+visual+(product.image_credit?'<small class="image-credit">صورة توضيحية</small>':"")+'</div><div class="product-info"><div class="product-category">'+escapeHtml(product.category)+' · '+escapeHtml(product.brand)+'</div><h3>'+escapeHtml(product.name_ar)+'</h3><div class="product-variant">'+escapeHtml(product.variant)+'</div><small class="listing-store">'+storeCaption+'</small><div class="price-row"><span class="current-price">'+money(listing?.price)+'</span><span class="currency">جنيه</span></div><div class="listing-source">لقطة السعر: '+escapeHtml(formatDate(listing?.date || product.source_checked_at))+'</div><div class="availability '+escapeHtml(status)+'">'+escapeHtml(availabilityText)+'</div><div class="card-actions"><button class="details-btn" data-details="'+escapeHtml(product.id)+'">التفاصيل والمصادر</button><a class="store-btn" href="'+escapeHtml(product.product_url||product.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener" aria-label="افتح صفحة المنتج الرسمية">↗</a></div></div></article>';
}
function renderFilters() {
  const categories = ["الكل", ...new Set(state.products.map(product=>product.category).filter(Boolean))];
  $("categoryFilters").innerHTML = categories.map(category=>'<button class="chip '+(category===state.category?'active':'')+'" data-category="'+escapeHtml(category)+'">'+escapeHtml(category)+'</button>').join("");
}
function render() {
  renderFilters();
  const items = applyFilters();
  const eligible = items.filter(product=>available(currentListing(product)));
  const pool = eligible.length ? eligible : items;
  const lowestPrice = Math.min(...pool.map(product=>Number(currentListing(product)?.price)||Infinity));
  const valueProduct = items.slice().sort((a,b)=>valueScore(b)-valueScore(a) || Number(currentListing(a)?.price)-Number(currentListing(b)?.price))[0];
  const biggestSaving = items.filter(product=>discount(product).amount>0).sort((a,b)=>discount(b).amount-discount(a).amount)[0];
  const badgesFor = product => {
    const badges=[];
    if (Number(currentListing(product)?.price)===lowestPrice && Number.isFinite(lowestPrice)) badges.push({kind:"lowest",text:"أقل سعر"});
    if (biggestSaving && product.id===biggestSaving.id) badges.push({kind:"saving",text:"أكبر توفير"});
    if (valueProduct && product.id===valueProduct.id) badges.push({kind:"value",text:"أفضل قيمة سعرية"});
    return badges;
  };
  $("productGrid").innerHTML = items.map(product=>card(product,badgesFor(product))).join("");
  $("resultCount").textContent = "عرض "+items.length.toLocaleString("ar-EG")+" من "+state.products.length.toLocaleString("ar-EG")+" منتج";
  $("emptyState").hidden = items.length !== 0;
  $("productGrid").hidden = items.length === 0;
  $("activeFilterSummary").textContent = "المتجر: "+(state.store || "كل المتاجر")+" · تاريخ اللقطة: "+(state.date?formatDate(state.date):"كل التواريخ")+" · مؤشر أفضل قيمة يعتمد على الخصم المُسجل والتوفر فقط.";
  renderBestPicks(items);
  $("productGrid").querySelectorAll("[data-details]").forEach(button=>button.addEventListener("click",()=>openDetails(button.dataset.details)));
  $("categoryFilters").querySelectorAll("[data-category]").forEach(button=>button.addEventListener("click",()=>{state.category=button.dataset.category;render();}));
}
function openDetails(id) {
  const product = state.products.find(item=>String(item.id)===String(id)); if (!product) return;
  const listing = currentListing(product);
  const visual = product.image ? '<img src="'+escapeHtml(product.image)+'" alt="'+escapeHtml(product.name_ar)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : visualFallback(product.category,product.brand);
  const competitorRows = offersFor(product).sort((a,b)=>a.price-b.price).slice(0,5).map(offer=>'<div class="mini-offer"><b>'+escapeHtml(offer.store)+'</b><span>'+money(offer.price)+' جنيه</span><small>'+escapeHtml(formatDate(offer.date))+' · '+escapeHtml(offer.warranty)+'</small></div>').join("");
  $("dialogContent").innerHTML = '<div class="dialog-product"><div class="dialog-media">'+visual+'</div><div class="dialog-info"><div class="product-category">'+escapeHtml(product.category)+' · '+escapeHtml(product.brand)+'</div><h2>'+escapeHtml(product.name_ar)+'</h2><div class="variant">'+escapeHtml(product.variant)+'</div><div class="dialog-price">'+money(listing?.price)+' <small>جنيه مصري</small></div>'+(product.old_price?'<div class="old-price">السعر السابق المُسجل: '+money(product.old_price)+' جنيه</div>':"")+'<p>'+escapeHtml(product.description)+'</p><div class="dialog-meta"><div><small>المتجر المختار</small><b>'+escapeHtml(listing?.store||"Vodafone Egypt")+'</b></div><div><small>تاريخ لقطة السعر</small><b>'+escapeHtml(formatDate(listing?.date||product.source_checked_at))+'</b></div></div><div class="dialog-offers"><b>عروض متاجر مرصودة للنسخة المطابقة</b>'+(competitorRows||'<small>لا توجد عروض منافسة مطابقة مسجلة لهذا المنتج حالياً.</small>')+'</div><p>'+escapeHtml(product.source_note||"السعر استرشادي؛ افتح المصدر وأكد السعر والتوفر قبل الشراء.")+'</p><div class="dialog-links"><a class="dialog-official" href="'+escapeHtml(product.product_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">تحقق من Vodafone ↗</a><a class="dialog-source" href="'+escapeHtml(listing?.source||product.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">مصدر اللقطة ↗</a></div></div></div>';
  $("productDialog").showModal();
}
function populateSelectors() {
  $("storeFilter").innerHTML = '<option value="">كل المتاجر</option>'+allStores().map(store=>'<option value="'+escapeHtml(store)+'">'+escapeHtml(store)+'</option>').join("");
  $("dateFilter").innerHTML = '<option value="">كل تواريخ اللقطات</option>'+allDates().map(date=>'<option value="'+escapeHtml(date)+'">'+escapeHtml(formatDate(date))+'</option>').join("");
}
async function loadProducts() {
  try {
    const [products,comparisons,market] = await Promise.all([
      getJson("data/products.json"),
      getJson("data/market-comparisons.json").catch(()=>({comparisons:[]})),
      getJson("data/market.json").catch(()=>({comparisons:[]}))
    ]);
    state.products=products;
    marketRecords=[...(comparisons.comparisons||[]),...(market.comparisons||[])];
  } catch (error) { state.products=[]; console.error(error); }
  const latestDate=allDates()[0];
  $("feedState").textContent="لقطات مؤرخة — بلا تحديث آلي";
  $("feedDate").textContent=latestDate?"أحدث لقطة: "+formatDate(latestDate)+" · ليست أسعاراً مباشرة":"تاريخ اللقطة غير متاح";
  $("sourceReviewDate").textContent=latestDate?formatDate(latestDate):"غير معروف";
  $("totalCount").textContent=state.products.length.toLocaleString("ar-EG");
  populateSelectors(); render();
}
$("searchInput").addEventListener("input",event=>{state.query=event.target.value.trim();render();});
$("sortSelect").addEventListener("change",event=>{state.sort=event.target.value;render();});
$("availableOnly").addEventListener("change",event=>{state.availableOnly=event.target.checked;render();});
$("storeFilter").addEventListener("change",event=>{state.store=event.target.value;render();});
$("dateFilter").addEventListener("change",event=>{state.date=event.target.value;render();});
$("minPrice").addEventListener("input",event=>{state.min=event.target.value;render();});
$("maxPrice").addEventListener("input",event=>{state.max=event.target.value;render();});
$("resetFilters").addEventListener("click",()=>{
  Object.assign(state,{category:"الكل",query:"",availableOnly:false,sort:"featured",store:"",date:"",min:"",max:""});
  $("searchInput").value="";$("availableOnly").checked=false;$("sortSelect").value="featured";
  $("storeFilter").value="";$("dateFilter").value="";$("minPrice").value="";$("maxPrice").value="";render();
});
$("clearSearch").addEventListener("click",()=>$("resetFilters").click());
$("dialogClose").addEventListener("click",()=>$("productDialog").close());
$("productDialog").addEventListener("click",event=>{if(event.target===$("productDialog"))$("productDialog").close();});
$("menuToggle").addEventListener("click",()=>$("mainNav")?.classList.toggle("open"));
loadProducts();
