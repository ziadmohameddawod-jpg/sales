const $ = (id) => document.getElementById(id);
const state = {
  products: [], category: "الكل", brand: "الكل", query: "", availableOnly: false,
  sort: "featured", store: "Vodafone Egypt", date: "", min: "", max: ""
};
let marketRecords = [];
let providerData = null;
const CATEGORY_ALIASES = {"تلفزيونات وأجهزة بث":"تلفزيونات","إكسسوارات لابتوب":"إكسسوارات"};
const CATEGORY_ORDER = ["هواتف","تابلت","تلفزيونات","ساعات ذكية","سماعات","سماعات متنقلة","إكسسوارات","راوتر وإنترنت","جيمينج"];
function compareCategories(a,b){const ai=CATEGORY_ORDER.indexOf(a),bi=CATEGORY_ORDER.indexOf(b);return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b,"ar");}
const FALLBACK_IMAGE = {
  "هواتف": brand => brand === "Samsung" ? '<div class="device-art samsung"><i class="lens"></i></div>' : '<div class="device-art"><i class="lens"></i></div>',
  "راوتر وإنترنت": () => '<div class="router-art"></div>',
  "إكسسوارات": () => '<div class="generic-art">⌁</div>'
};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money = value => {
  const amount = value === null || value === undefined || value === "" ? NaN : Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat("ar-EG", {maximumFractionDigits: 0}).format(Math.round(amount))
    : "—";
};
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
function variantStorageTokens(value) {
  return [...String(value || "").matchAll(/(\d+(?:\.\d+)?)\s*(GB|TB)\b/gi)]
    .map(match => Number(match[1]) * (match[2].toUpperCase() === "TB" ? 1024 : 1));
}

function productRecords(product) {
  const productId = String(product.id);
  const exactIdMatches = marketRecords.filter(record =>
    String(record.product_id || record.id || "") === productId
  );
  const providerMatches = exactIdMatches.filter(record => record.provider_sync === true);
  if (providerMatches.length) return providerMatches;
  if (exactIdMatches.length) return exactIdMatches;

  const productName = normalize(product.name_ar);
  const productTokens = variantStorageTokens(product.variant);
  return marketRecords.filter(record => {
    const recordName = normalize(record.title || record.name);
    if (!recordName || recordName !== productName) return false;

    const matchStatus = String(record.match_status || "").toLowerCase();
    if (/غير\s+قابلة|غير\s+مطابقة|different|mismatch|not\s+comparable/.test(matchStatus)) return false;

    const recordTokens = variantStorageTokens(record.variant);
    if (productTokens.length && recordTokens.length &&
        (productTokens.length !== recordTokens.length ||
         productTokens.some((token, index) => token !== recordTokens[index]))) return false;

    return true;
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
    const recordMatch = String(record.match_status || "").toLowerCase();
    if (/غير\s+قابلة|غير\s+مطابقة|different|mismatch|not\s+comparable/.test(recordMatch)) return;

    const snapshotDate = record.as_of || record.checked_at || "";
    (record.offers || record.market_offers || []).forEach(offer => {
      const store = offer.store || offer.seller;
      const price = offer.price === null || offer.price === undefined || offer.price === "" ? NaN : Number(offer.price);
      if (!store || !Number.isFinite(price) || price <= 0) return;
      if (offer.comparison_status && offer.comparison_status !== "same_core_variant") return;

      entries.push({
        store,
        price,
        status:normalizeStatus(offer.status),
        date:offer.checked_at || offer.as_of || snapshotDate,
        source:offer.source_url || offer.url || record.tracker_source || record.source_url || "",
        provider:offer.source_provider || record.provider || "",
        observedAt:offer.observed_at || "",
        warranty:offer.warranty || "الضمان غير مؤكد"
      });
    });
  });
  return entries;
}
function currentListing(product) {
  if (!state.store || state.store === "Vodafone Egypt") {
    const price = product.price === null || product.price === undefined || product.price === "" ? NaN : Number(product.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      store:"Vodafone Egypt",
      price,
      status:normalizeStatus(product.status),
      date:product.source_checked_at || "",
      source:product.source_url || product.product_url || ""
    };
  }

  let offers = offersFor(product).filter(offer =>
    offer.store === state.store && (!state.date || offer.date === state.date)
  );
  if (!offers.length) return null;

  if (!state.date) {
    const datedOffers = offers.filter(offer => /^\d{4}-\d{2}-\d{2}$/.test(offer.date));
    if (datedOffers.length) {
      const latestDate = datedOffers.reduce((latest, offer) => offer.date > latest ? offer.date : latest, "");
      offers = datedOffers.filter(offer => offer.date === latestDate);
    }
  }

  const statusPriority = {in_stock:0, limited:1, unknown:2, sold_out:3};
  offers.sort((a,b) =>
    (statusPriority[a.status] ?? 2) - (statusPriority[b.status] ?? 2) ||
    a.price - b.price
  );
  return offers[0] || null;
}
function comparableOfferCount() {
  const seen = new Set();
  state.products.forEach(product => offersFor(product).forEach(offer => {
    seen.add([product.id,offer.store,offer.price,offer.date].join("|"));
  }));
  return seen.size;
}
function allStores() {
  const stores = state.products.flatMap(product => offersFor(product).map(offer => offer.store));
  return [...new Set(["Vodafone Egypt", ...stores])].sort((a,b)=>a.localeCompare(b));
}
function allDates() {
  const dates = new Set(state.products.map(product => product.source_checked_at).filter(Boolean));
  state.products.forEach(product => offersFor(product).forEach(offer => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(offer.date)) dates.add(offer.date);
  }));
  return [...dates].sort((a,b)=>b.localeCompare(a));
}
function available(listing) { return !!listing && listing.status === "in_stock"; }
function discount(product) {
  if (state.store && state.store !== "Vodafone Egypt") return {amount:0,percent:0};
  const old = product.old_price === null || product.old_price === undefined ? NaN : Number(product.old_price);
  const now = product.price === null || product.price === undefined ? NaN : Number(product.price);
  return Number.isFinite(old) && Number.isFinite(now) && old > now && now > 0
    ? {amount:old-now, percent:(old-now)/old*100}
    : {amount:0,percent:0};
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
      (state.brand === "الكل" || product.brand === state.brand) &&
      (!state.query || text.includes(normalize(state.query))) &&
      (!state.availableOnly || available(listing)) &&
      (!state.store || !!listing) && dateMatch &&
      (!state.min || price >= Number(state.min)) && (!state.max || price <= Number(state.max));
  });
  const priceOf = product => {
    const price = Number(currentListing(product)?.price);
    return Number.isFinite(price) && price > 0 ? price : Infinity;
  };
  const comparePrice = (a,b,direction) => {
    const priceA = priceOf(a), priceB = priceOf(b);
    const validA = Number.isFinite(priceA), validB = Number.isFinite(priceB);
    if (validA !== validB) return validA ? -1 : 1;
    if (!validA) return 0;
    return (priceA - priceB) * direction;
  };
  if (state.sort === "price-asc") items.sort((a,b)=>comparePrice(a,b,1));
  if (state.sort === "price-desc") items.sort((a,b)=>comparePrice(a,b,-1));
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
  const pricedItems = items.filter(product => {
    const price = Number(currentListing(product)?.price);
    return Number.isFinite(price) && price > 0;
  });
  const availableItems = pricedItems.filter(product=>available(currentListing(product)));
  const byPrice = (availableItems.length ? availableItems : pricedItems).slice().sort((a,b)=>Number(currentListing(a).price)-Number(currentListing(b).price));
  const lowest = byPrice[0];
  const savings = state.store === "Vodafone Egypt"
    ? pricedItems.filter(product=>discount(product).amount>0).slice().sort((a,b)=>discount(b).amount-discount(a).amount)[0]
    : null;
  const value = pricedItems.slice().sort((a,b)=>valueScore(b)-valueScore(a) || Number(currentListing(a).price)-Number(currentListing(b).price))[0];
  const picks = [
    {product:lowest,label:"أقل سعر ضمن النتائج",detail:lowest?money(currentListing(lowest).price)+" جنيه"+(availableItems.length?" · توفر مؤكد في اللقطة":" · لا يوجد مخزون مؤكد في النتائج"):"لا توجد نتيجة",kind:"lowest"},
    {product:savings,label:"أكبر توفير مُسجل",detail:savings?"وفر "+money(discount(savings).amount)+" جنيه مقارنة بالسعر السابق":"لا توجد أسعار سابقة مسجلة",kind:"saving"},
    {product:value,label:"مؤشر السعر والتوفر",detail:value?(discount(value).percent?discount(value).percent.toFixed(0)+"% خصم مسجل":"متاح بسعر "+money(currentListing(value)?.price)+" جنيه")+" · مؤشر سعر وتوفر فقط":"—",kind:"value"}
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
  return '<article class="product-card"><div class="product-media"><span class="product-badge '+escapeHtml(status)+'">'+escapeHtml(statusText)+'</span><div class="recommend-badges">'+tags+'</div>'+visual+(product.image_credit?'<small class="image-credit">مصدر الصورة: '+escapeHtml(product.image_credit)+'</small>':"")+'</div><div class="product-info"><div class="product-category">'+escapeHtml(product.category)+' · '+escapeHtml(product.brand)+'</div><h3>'+escapeHtml(product.name_ar)+'</h3><div class="product-variant">'+escapeHtml(product.variant)+'</div><small class="listing-store">'+storeCaption+'</small><div class="price-row"><span class="current-price">'+money(listing?.price)+'</span><span class="currency">جنيه</span></div><div class="listing-source">لقطة السعر: '+escapeHtml(formatDate(listing?.date || product.source_checked_at))+'</div><div class="availability '+escapeHtml(status)+'">'+escapeHtml(availabilityText)+'</div><div class="card-actions"><button class="details-btn" data-details="'+escapeHtml(product.id)+'">التفاصيل والمصادر</button><a class="store-btn" href="'+escapeHtml(product.product_url||product.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener" aria-label="افتح صفحة المنتج الرسمية">↗</a></div></div></article>';
}
function renderFilters() {
  const categoryCounts = new Map();
  state.products.forEach(product => categoryCounts.set(product.category, (categoryCounts.get(product.category) || 0) + 1));
  const categories = ["الكل", ...[...categoryCounts.keys()].sort(compareCategories)];
  $("categoryFilters").innerHTML = categories.map(category => {
    const count = category === "الكل" ? state.products.length : categoryCounts.get(category);
    return '<button class="chip '+(category===state.category?'active':'')+'" data-category="'+escapeHtml(category)+'" aria-pressed="'+(category===state.category)+'"><span>'+escapeHtml(category)+'</span><small>'+Number(count||0).toLocaleString("ar-EG")+'</small></button>';
  }).join("");

  const brandCounts = new Map();
  state.products
    .filter(product => state.category === "الكل" || product.category === state.category)
    .forEach(product => brandCounts.set(product.brand, (brandCounts.get(product.brand) || 0) + 1));
  const brands = [...brandCounts.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0], "ar"));
  if (state.brand !== "الكل" && !brandCounts.has(state.brand)) state.brand = "الكل";
  const brandTiles = [["الكل", [...brandCounts.values()].reduce((sum,count)=>sum+count,0)], ...brands];
  $("brandFilters").innerHTML = brandTiles.map(([brand,count]) => {
    const mark = brand === "الكل" ? '<span class="brand-mark-all">كل</span>' : '<span class="brand-wordmark '+brandClass(brand)+'">'+escapeHtml(brandMark(brand))+'</span>';
    return '<button class="brand-tile '+(brand===state.brand?'active':'')+'" data-brand="'+escapeHtml(brand)+'" aria-pressed="'+(brand===state.brand)+'">'+mark+'<b>'+escapeHtml(brand)+'</b><small>'+Number(count||0).toLocaleString("ar-EG")+' منتج</small></button>';
  }).join("");
  $("brandResultCount").textContent = brands.length.toLocaleString("ar-EG") + " ماركة";
}

function brandClass(brand) {
  return "brand-" + normalize(brand).replace(/\s+/g,"-");
}
function brandMark(brand) {
  const marks = {
    Apple:"APPLE", Samsung:"SAMSUNG", Xiaomi:"mi", realme:"realme",
    Infinix:"Infinix", HONOR:"HONOR", Huawei:"HUAWEI", Vivo:"vivo",
    TECNO:"TECNO", Sony:"SONY", Motorola:"MOTOROLA", JBL:"JBL",
    Anker:"soundcore", Amazfit:"amazfit", Lenovo:"Lenovo",
    Tornado:"TORNADO", Vodafone:"vodafone", Redragon:"REDRAGON",
    Marshall:"Marshall", Jabra:"Jabra", Mibro:"Mibro", Oraimo:"oraimo",
    AUKEY:"AUKEY", Cardoo:"CARDOO", Weofly:"Weofly", Recci:"RECCI"
  };
  return marks[brand] || String(brand || "").toUpperCase();
}

function renderProductGroups(items, badgesFor) {
  const categoryGroups = new Map();
  items.forEach(product => {
    if (!categoryGroups.has(product.category)) categoryGroups.set(product.category, []);
    categoryGroups.get(product.category).push(product);
  });
  return [...categoryGroups.entries()].sort((a,b)=>compareCategories(a[0],b[0])).map(([category, categoryItems]) => {
    const brandGroups = new Map();
    categoryItems.forEach(product => {
      if (!brandGroups.has(product.brand)) brandGroups.set(product.brand, []);
      brandGroups.get(product.brand).push(product);
    });
    const groupsMarkup = [...brandGroups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"ar")).map(([brand, brandItems]) =>
      '<section class="brand-product-group"><div class="brand-group-heading"><div><span class="brand-group-mark '+brandClass(brand)+'">'+escapeHtml(brandMark(brand))+'</span><h4>'+escapeHtml(brand)+'</h4></div><small>'+brandItems.length.toLocaleString("ar-EG")+' منتج</small></div><div class="product-grid">'+brandItems.map(product=>card(product,badgesFor(product))).join("")+'</div></section>'
    ).join("");
    return '<section class="catalog-type-group"><div class="catalog-type-heading"><div><span>نوع المنتج</span><h3>'+escapeHtml(category)+'</h3></div><small>'+categoryItems.length.toLocaleString("ar-EG")+' منتج</small></div>'+groupsMarkup+'</section>';
  }).join("");
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
    if (valueProduct && product.id===valueProduct.id) badges.push({kind:"value",text:"مؤشر السعر والتوفر"});
    return badges;
  };
  $("productGrid").innerHTML = renderProductGroups(items,badgesFor);
  $("resultCount").textContent = "عرض "+items.length.toLocaleString("ar-EG")+" من "+state.products.length.toLocaleString("ar-EG")+" منتج";
  $("emptyState").hidden = items.length !== 0;
  $("productGrid").hidden = items.length === 0;
  $("activeFilterSummary").textContent = "النوع: "+state.category+" · الماركة: "+state.brand+" · المتجر: "+(state.store || "كل المتاجر")+" · تاريخ اللقطة: "+(state.date?formatDate(state.date):"كل التواريخ")+" · مؤشر أفضل قيمة يعتمد على الخصم المُسجل والتوفر فقط.";
  renderBestPicks(items);
  $("productGrid").querySelectorAll("[data-details]").forEach(button=>button.addEventListener("click",()=>openDetails(button.dataset.details)));
  $("categoryFilters").querySelectorAll("[data-category]").forEach(button=>button.addEventListener("click",()=>{state.category=button.dataset.category;state.brand="الكل";render();}));
  $("brandFilters").querySelectorAll("[data-brand]").forEach(button=>button.addEventListener("click",()=>{state.brand=button.dataset.brand;render();}));
}
function openDetails(id) {
  const product = state.products.find(item=>String(item.id)===String(id)); if (!product) return;
  const listing = currentListing(product);
  const visual = product.image ? '<img src="'+escapeHtml(product.image)+'" alt="'+escapeHtml(product.name_ar)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : visualFallback(product.category,product.brand);
  const competitorRows = offersFor(product).sort((a,b)=>a.price-b.price).slice(0,5).map(offer=>'<div class="mini-offer"><b>'+escapeHtml(offer.store)+'</b><span>'+money(offer.price)+' جنيه</span><small>'+escapeHtml(offer.observedAt ? new Intl.DateTimeFormat("ar-EG",{dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Cairo"}).format(new Date(offer.observedAt)) : formatDate(offer.date))+' · '+escapeHtml(offer.warranty)+(offer.provider?' · '+escapeHtml(offer.provider):"")+'</small>'+(offer.source?'<a href="'+escapeHtml(offer.source)+'" target="_blank" rel="noopener">مصدر السعر ↗</a>':"")+'</div>').join("");
  $("dialogContent").innerHTML = '<div class="dialog-product"><div class="dialog-media">'+visual+'</div><div class="dialog-info"><div class="product-category">'+escapeHtml(product.category)+' · '+escapeHtml(product.brand)+'</div><h2>'+escapeHtml(product.name_ar)+'</h2><div class="variant">'+escapeHtml(product.variant)+'</div><div class="dialog-price">'+money(listing?.price)+' <small>جنيه مصري</small></div>'+(product.old_price?'<div class="old-price">السعر السابق المُسجل: '+money(product.old_price)+' جنيه</div>':"")+'<p>'+escapeHtml(product.description)+'</p><div class="dialog-meta"><div><small>المتجر المختار</small><b>'+escapeHtml(listing?.store||"Vodafone Egypt")+'</b></div><div><small>تاريخ لقطة السعر</small><b>'+escapeHtml(formatDate(listing?.date||product.source_checked_at))+'</b></div></div><div class="dialog-offers"><b>عروض متاجر مرصودة للنسخة المطابقة</b>'+(competitorRows||'<small>لا توجد عروض منافسة مطابقة مسجلة لهذا المنتج حالياً.</small>')+'</div><p>'+escapeHtml(product.source_note||"السعر استرشادي؛ افتح المصدر وأكد السعر والتوفر قبل الشراء.")+'</p><div class="dialog-links"><a class="dialog-official" href="'+escapeHtml(product.product_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">تحقق من Vodafone ↗</a><a class="dialog-source" href="'+escapeHtml(listing?.source||product.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">مصدر اللقطة ↗</a></div></div></div>';
  $("productDialog").showModal();
}
function populateSelectors() {
  $("storeFilter").innerHTML = allStores().map(store =>
    '<option value="'+escapeHtml(store)+'">'+escapeHtml(store === "Vodafone Egypt" ? "Vodafone Egypt — السعر المرجعي" : store)+'</option>'
  ).join("");
  $("storeFilter").value = state.store;
  $("dateFilter").innerHTML = '<option value="">كل تواريخ اللقطات</option>'+allDates().map(date=>'<option value="'+escapeHtml(date)+'">'+escapeHtml(formatDate(date))+'</option>').join("");
}
async function loadProducts() {
  try {
    const [products,comparisons,market,provider] = await Promise.all([
      getJson("data/products.json"),
      getJson("data/market-comparisons.json").catch(()=>({comparisons:[]})),
      getJson("data/market.json").catch(()=>({comparisons:[]})),
      getJson("data/price-provider.json").catch(()=>null)
    ]);
    state.products=products.map(product=>({...product,category:CATEGORY_ALIASES[product.category]||product.category}));
    providerData=provider;
    marketRecords=[...(provider?.comparisons||[]),...(comparisons.comparisons||[]),...(market.comparisons||[])];
  } catch (error) { state.products=[]; console.error(error); }
  const latestDate=allDates()[0];
  const lastSync = providerData?.last_successful_sync ? new Date(providerData.last_successful_sync) : null;
  const partialSync = providerData?.last_partial_sync ? new Date(providerData.last_partial_sync) : null;
  const syncValid = lastSync && Number.isFinite(lastSync.getTime());
  const partialValid = partialSync && Number.isFinite(partialSync.getTime());
  const syncAgeHours = syncValid ? (Date.now() - lastSync.getTime()) / 3600000 : Infinity;
  const syncLabel = syncValid
    ? new Intl.DateTimeFormat("ar-EG", {dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Cairo"}).format(lastSync)
    : "";
  const partialLabel = partialValid
    ? new Intl.DateTimeFormat("ar-EG", {dateStyle:"medium",timeStyle:"short",timeZone:"Africa/Cairo"}).format(partialSync)
    : "";
  if (syncValid) {
    const isStale = syncAgeHours > Number(providerData.stale_after_hours || 24);
    const isPartial = providerData.sync_status === "partial";
    const feedStatus = $("feedState").parentElement?.parentElement;
    feedStatus?.classList.toggle("stale", isStale);
    feedStatus?.classList.toggle("partial", isPartial);
    $("feedState").textContent = isStale ? "آخر نجاح كامل قديم" :
      isPartial ? "آخر محاولة جزئية — توجد بيانات لم تتحدث" : "آخر مزامنة مكتملة للمنافسين";
    const coverage = providerData.coverage || {};
    const partialNote = isPartial
      ? " · محاولة جزئية " + (partialLabel || "حديثة") + " · فشل " + Number(coverage.products_failed_this_run || 0).toLocaleString("ar-EG") + " · لم تُحدّث " + Number(coverage.products_not_attempted_this_run || 0).toLocaleString("ar-EG")
      : "";
    $("feedDate").textContent = "Prices by PriceLens · آخر نجاح كامل: " + syncLabel + " بتوقيت القاهرة · " +
      Number(coverage.current_offers || 0).toLocaleString("ar-EG") + " عرضاً" + partialNote +
      (isStale ? " · البيانات أقدم من 24 ساعة" : "");
  } else if (partialValid) {
    const feedStatus = $("feedState").parentElement?.parentElement;
    feedStatus?.classList.add("partial");
    $("feedState").textContent = "توجد محاولة مزامنة جزئية دون نجاح كامل سابق";
    $("feedDate").textContent = "آخر محاولة: " + partialLabel + " بتوقيت القاهرة · لم يتم اعتمادها كنجاح كامل";
  } else {
    $("feedState").textContent="لقطات أسعار محفوظة — لا توجد مزامنة ناجحة مسجلة";
    $("feedDate").textContent=latestDate?"أحدث لقطة محفوظة: "+formatDate(latestDate)+" · الأسعار ليست مباشرة":"لا يوجد تاريخ رصد متاح";
  }
  $("sourceReviewDate").textContent=syncValid?syncLabel:(latestDate?formatDate(latestDate):"غير معروف");
  $("totalCount").textContent=state.products.length.toLocaleString("ar-EG");
  $("photoCount").textContent=state.products.filter(product=>!!product.image).length.toLocaleString("ar-EG");
  $("marketOfferCount").textContent=comparableOfferCount().toLocaleString("ar-EG");
  $("lastSnapshot").textContent=latestDate?formatDate(latestDate):"—";
  $("roadmapProductCount").textContent=state.products.length.toLocaleString("ar-EG");
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
  Object.assign(state,{category:"الكل",brand:"الكل",query:"",availableOnly:false,sort:"featured",store:"Vodafone Egypt",date:"",min:"",max:""});
  $("searchInput").value="";$("availableOnly").checked=false;$("sortSelect").value="featured";
  $("storeFilter").value="";$("dateFilter").value="";$("minPrice").value="";$("maxPrice").value="";render();
});
$("clearSearch").addEventListener("click",()=>$("resetFilters").click());
$("dialogClose").addEventListener("click",()=>$("productDialog").close());
$("productDialog").addEventListener("click",event=>{if(event.target===$("productDialog"))$("productDialog").close();});
$("menuToggle").addEventListener("click",()=>$("mainNav")?.classList.toggle("open"));
loadProducts();
