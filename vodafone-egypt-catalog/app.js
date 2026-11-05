const CONFIG = window.CATALOG_CONFIG || {};
const $ = (id) => document.getElementById(id);
const state = { products: [], category: "الكل", query: "", availableOnly: false, sort: "featured", source: "local" };
const FALLBACK_IMAGE = {
  "هواتف": (brand, name) => brand === "Samsung" ? '<div class="device-art samsung"><i class="lens"></i></div>' : '<div class="device-art"><i class="lens"></i></div>',
  "راوتر وإنترنت": () => '<div class="router-art"></div>',
  "إكسسوارات": () => '<div class="generic-art">⌁</div>'
};
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(n) : "—";
}
function csvToObjects(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i=0; i<text.length; i++) {
    const c=text[i], next=text[i+1];
    if (c === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === ',' && !quoted) { row.push(cell); cell=""; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && next === '\n') i++;
      row.push(cell); if (row.some(v=>v.trim())) rows.push(row); row=[]; cell="";
    } else cell += c;
  }
  row.push(cell); if (row.some(v=>v.trim())) rows.push(row);
  const headers=(rows.shift()||[]).map(v=>v.trim());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]||"").trim()])));
}
function fromSheet(row) {
  const active = String(row.active ?? "TRUE").toLowerCase();
  if (["false","0","no","لا"].includes(active)) return null;
  return {
    id: row.id, name_ar: row.name_ar || row.name, brand: row.brand || "", category: row.category || "أخرى",
    variant: row.variant || "", price: Number(String(row.price||"").replace(/[^0-9.]/g,"")),
    old_price: row.old_price ? Number(String(row.old_price).replace(/[^0-9.]/g,"")) : null,
    availability: row.availability || "تحقق من التوفر",
    status: /غير متوفر|نفد/i.test(row.availability||"") ? "out" : /محدود/i.test(row.availability||"") ? "limited" : "check",
    image: row.image_url || row.image || null, description: row.description || "",
    product_url: row.product_url || "", source_url: row.source_url || row.product_url || "",
    source_checked_at: row.source_checked_at || "", source_note: row.source_note || ""
  };
}
async function loadProducts() {
  try {
    const res = await fetch("data/products.json?v="+Date.now(), {cache:"no-store"});
    if (!res.ok) throw new Error("تعذر قراءة ملف المنتجات");
    state.products = await res.json();
    state.source = "local";
  } catch (e) {
    state.products = [];
    console.error(e);
  }
  if (CONFIG.sheetCsvUrl) {
    try {
      const res = await fetch(CONFIG.sheetCsvUrl, {cache:"no-store"});
      if (!res.ok) throw new Error("تعذر قراءة Google Sheets");
      const csv = await res.text();
      const products = csvToObjects(csv).map(fromSheet).filter(Boolean).filter(p=>p.name_ar && Number.isFinite(p.price));
      if (products.length) { state.products = products; state.source = "sheet"; }
    } catch (e) { console.warn("Google Sheets feed unavailable; using bundled catalog.", e); }
  }
  $("feedState").textContent = state.source === "sheet" ? "متصل ببيانات Google Sheets" : "بيانات الكتالوج الأساسية";
  $("feedDate").textContent = "آخر جلب من الموقع: " + new Date().toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit"});
  $("totalCount").textContent = state.products.length.toLocaleString("ar-EG");
  render();
}
function productVisual(p) {
  if (p.image) return '<img src="'+escapeHtml(p.image)+'" alt="'+escapeHtml(p.name_ar)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.innerHTML=visualFallback(this.dataset.category,this.dataset.brand)">';
  return visualFallback(p.category,p.brand);
}
function visualFallback(category, brand) {
  const renderer = FALLBACK_IMAGE[category] || (()=>'<div class="generic-art">◇</div>');
  return renderer(brand, "");
}
function card(p) {
  const badge = p.status === "out" ? "غير متوفر" : p.status === "limited" ? "مخزون محدود" : "تحقق من التوفر";
  const old = p.old_price ? '<span class="old-price">'+formatPrice(p.old_price)+'</span>' : "";
  const visual = p.image
    ? '<img src="'+escapeHtml(p.image)+'" alt="'+escapeHtml(p.name_ar)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\'none\';this.nextElementSibling.hidden=false"><div class="fallback-holder" hidden>'+visualFallback(p.category,p.brand)+'</div>'
    : visualFallback(p.category,p.brand);
  return '<article class="product-card"><div class="product-media"><span class="product-badge '+p.status+'">'+badge+'</span>'+visual+(p.image_credit?'<small class="image-credit">صورة توضيحية</small>':"")+'</div><div class="product-info"><div class="product-category">'+escapeHtml(p.category)+' · '+escapeHtml(p.brand)+'</div><h3>'+escapeHtml(p.name_ar)+'</h3><div class="product-variant">'+escapeHtml(p.variant)+'</div><div class="price-row"><span class="current-price">'+formatPrice(p.price)+'</span><span class="currency">جنيه</span>'+old+'</div><div class="availability '+p.status+'">'+escapeHtml(p.availability)+'</div><div class="card-actions"><button class="details-btn" data-details="'+escapeHtml(p.id)+'">التفاصيل</button><a class="store-btn" href="'+escapeHtml(p.product_url||p.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener" aria-label="افتح المنتج في المتجر الرسمي">↗</a></div></div></article>';
}
function filteredProducts() {
  let products = state.products.filter(p => {
    const text = [p.name_ar,p.brand,p.category,p.variant,p.description].join(" ").toLowerCase();
    const categoryOk = state.category === "الكل" || p.category === state.category;
    const queryOk = !state.query || text.includes(state.query.toLowerCase());
    const availableOk = !state.availableOnly || ["in","limited"].includes(p.status);
    return categoryOk && queryOk && availableOk;
  });
  if (state.sort === "price-asc") products.sort((a,b)=>a.price-b.price);
  if (state.sort === "price-desc") products.sort((a,b)=>b.price-a.price);
  if (state.sort === "name") products.sort((a,b)=>a.name_ar.localeCompare(b.name_ar,"ar"));
  return products;
}
function renderFilters() {
  const categories = ["الكل", ...new Set(state.products.map(p=>p.category).filter(Boolean))];
  $("categoryFilters").innerHTML = categories.map(c=>'<button class="chip '+(c===state.category?'active':'')+'" data-category="'+escapeHtml(c)+'">'+escapeHtml(c)+'</button>').join("");
}
function render() {
  renderFilters();
  const products = filteredProducts();
  $("productGrid").innerHTML = products.map(card).join("");
  $("resultCount").textContent = "عرض "+products.length.toLocaleString("ar-EG")+" من "+state.products.length.toLocaleString("ar-EG")+" منتج";
  $("emptyState").hidden = products.length !== 0;
  $("productGrid").hidden = products.length === 0;
  $("productGrid").querySelectorAll("[data-details]").forEach(btn=>btn.addEventListener("click",()=>openDetails(btn.dataset.details)));
  $("categoryFilters").querySelectorAll("[data-category]").forEach(btn=>btn.addEventListener("click",()=>{state.category=btn.dataset.category;render();}));
}
function openDetails(id) {
  const p = state.products.find(x=>String(x.id)===String(id)); if (!p) return;
  const visual = p.image ? '<img src="'+escapeHtml(p.image)+'" alt="'+escapeHtml(p.name_ar)+'" referrerpolicy="no-referrer" onerror="this.style.display=\'none\'">' : visualFallback(p.category,p.brand);
  $("dialogContent").innerHTML = '<div class="dialog-product"><div class="dialog-media">'+visual+'</div><div class="dialog-info"><div class="product-category">'+escapeHtml(p.category)+' · '+escapeHtml(p.brand)+'</div><h2>'+escapeHtml(p.name_ar)+'</h2><div class="variant">'+escapeHtml(p.variant)+'</div><div class="dialog-price">'+formatPrice(p.price)+' <small style="font:11px Alexandria,Arial;color:#888">جنيه مصري</small></div>'+(p.old_price?'<div class="old-price">السعر المقارن: '+formatPrice(p.old_price)+' جنيه</div>':"")+'<p>'+escapeHtml(p.description)+'</p><div class="dialog-meta"><div><small>حالة التوفر</small><b>'+escapeHtml(p.availability)+'</b></div><div><small>تاريخ مرجع السعر</small><b>'+escapeHtml(p.source_checked_at||"راجع المصدر")+'</b></div></div><p>'+escapeHtml(p.source_note||"يُرجى التأكد من السعر والتوفر لدى المتجر الرسمي قبل الشراء.")+'</p><div class="dialog-links"><a class="dialog-official" href="'+escapeHtml(p.product_url||p.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">تحقق من فودافون ↗</a><a class="dialog-source" href="'+escapeHtml(p.source_url||"https://eshop.vodafone.com.eg/ar/")+'" target="_blank" rel="noopener">مصدر البيانات ↗</a></div></div></div>';
  $("productDialog").showModal();
}
$("searchInput").addEventListener("input",e=>{state.query=e.target.value.trim();render();});
$("sortSelect").addEventListener("change",e=>{state.sort=e.target.value;render();});
$("availableOnly").addEventListener("change",e=>{state.availableOnly=e.target.checked;render();});
$("resetFilters").addEventListener("click",()=>{state.category="الكل";state.query="";state.availableOnly=false;state.sort="featured";$("searchInput").value="";$("availableOnly").checked=false;$("sortSelect").value="featured";render();});
$("clearSearch").addEventListener("click",()=>$("resetFilters").click());
$("dialogClose").addEventListener("click",()=>$("productDialog").close());
$("productDialog").addEventListener("click",e=>{if(e.target===$("productDialog"))$("productDialog").close();});
$("menuToggle").addEventListener("click",()=>$("mainNav")?.classList.toggle("open"));
loadProducts();
if (CONFIG.refreshEveryMs) setInterval(loadProducts,CONFIG.refreshEveryMs);
