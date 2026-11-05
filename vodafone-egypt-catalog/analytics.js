(() => {
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0)) + " ج.م";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  let marketData = null;
  let historyData = null;
  let products = [];

  async function readJson(path) {
    const response = await fetch(path + "?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("Failed to load " + path + ": " + response.status);
    return response.json();
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).slice().sort((a,b)=>a-b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2;
  }

  function percent(value) {
    if (!Number.isFinite(value)) return "—";
    return (value > 0 ? "+" : "") + value.toFixed(1) + "%";
  }

  function renderComparison() {
    const selectedId = $("marketProductSelect").value;
    const record = marketData.comparisons.find(x => x.product_id === selectedId);
    if (!record) return;

    const marketPrices = record.offers.map(x => Number(x.price)).filter(Number.isFinite);
    const marketMedian = median(marketPrices);
    const low = marketPrices.length ? Math.min(...marketPrices) : null;
    const catalogPrice = Number(record.vodafone_catalog_price);
    const trackerPrice = Number(record.vodafone_tracker_price);
    const vsMedian = marketMedian ? ((catalogPrice / marketMedian) - 1) * 100 : null;
    const vsLow = low ? catalogPrice - low : null;

    $("marketSummary").innerHTML = [
      '<div class="metric-card"><small>وسيط عروض السوق المدرجة</small><b>'+money(marketMedian)+'</b><span>وسيط البائعين المدرجين فقط، وليس متوسط كل السوق.</span></div>',
      '<div class="metric-card"><small>أقل سعر سوقي مدرج</small><b>'+money(low)+'</b><span>من '+marketPrices.length+' عروض قابلة للمقارنة في اللقطة.</span></div>',
      '<div class="metric-card highlight"><small>سعر فودافون في الكتالوج</small><b>'+money(catalogPrice)+'</b><span>'+(vsMedian === null ? "لا توجد مقارنة كافية" : (vsMedian >= 0 ? "أعلى من وسيط السوق بـ " : "أقل من وسيط السوق بـ ") + Math.abs(vsMedian).toFixed(1)+"%")+'</span></div>'
    ].join("");

    $("marketVariant").textContent = record.variant;
    $("marketAsOf").textContent = "تاريخ اللقطة: " + record.as_of;
    let rows = record.offers.map(x=>({store:x.store,price:Number(x.price),tag:x.warranty || "الضمان غير مؤكد",kind:"market"}));
    rows.push({store:"Vodafone Egypt — لقطة الكتالوج",price:catalogPrice,tag:"سعر المنتج المسجل",kind:"direct"});
    if (Number.isFinite(trackerPrice) && trackerPrice !== catalogPrice) {
      rows.push({store:"Vodafone Egypt — وفق متتبع الأسعار",price:trackerPrice,tag:"رصد طرف ثالث؛ يحتاج تأكيد المتجر",kind:"reported"});
    }
    rows.sort((a,b)=>a.price-b.price);
    $("marketRows").innerHTML = rows.map(row => {
      const tag = row.kind === "direct" ? '<span class="row-tag direct">'+escapeHtml(row.tag)+'</span>' :
        row.kind === "reported" ? '<span class="row-tag reported">'+escapeHtml(row.tag)+'</span>' :
        '<span class="row-tag">'+escapeHtml(row.tag)+'</span>';
      return '<tr class="'+(row.kind==="direct"?"vodafone-row":"")+(row.price===low?" market-low":"")+'"><td>'+escapeHtml(row.store)+'</td><td>'+money(row.price)+'</td><td>'+tag+'</td></tr>';
    }).join("");
    $("marketSourceNote").textContent = record.source_note + " فارق سعر فودافون عن أقل عرض مدرج: " + (vsLow === null ? "غير متاح" : money(vsLow)) + ". لا يعني السعر الأقل تلقائياً ضماناً أفضل أو بائعاً معتمداً.";
    $("marketSourceLinks").innerHTML =
      '<a href="'+escapeHtml(record.tracker_source)+'" target="_blank" rel="noopener">مصدر مقارنة السوق ↗</a>' +
      '<a href="'+escapeHtml(record.vodafone_source)+'" target="_blank" rel="noopener">صفحة فودافون للمنتج ↗</a>';
  }

  function drawHistory(productId) {
    const series = historyData.series.find(x => x.product_id === productId);
    const minRequired = historyData.required_observations_for_trend || 8;
    if (!series || !series.observations.length) {
      $("historyCount").textContent = "0 / " + minRequired + " قراءات مطلوبة";
      $("historyChart").innerHTML = '<div class="history-empty">لا يوجد سجل سعر مؤرخ لهذا الموديل بعد.</div>';
      $("historyNote").textContent = "نحتاج تسجيل أسعار أسبوعية متطابقة للموديل والنسخة قبل حساب اتجاه موثوق.";
      $("trendReadiness").textContent = "لا توجد قراءات تاريخية لهذا المنتج؛ لا يمكن إصدار توقع إحصائي.";
      return;
    }
    const points = series.observations.slice().sort((a,b)=>a.date.localeCompare(b.date));
    const width=520,height=150,pad=28;
    const values=points.map(x=>Number(x.price));
    const lo=Math.min(...values),hi=Math.max(...values),span=Math.max(1,hi-lo);
    const coords=points.map((p,i)=>({
      x:pad+(points.length===1?0:i*(width-2*pad)/(points.length-1)),
      y:height-pad-((p.price-lo)/span)*(height-2*pad),
      date:p.date,
      price:p.price
    }));
    const path=coords.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1)).join(" ");
    const circles=coords.map(p=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="4" fill="#e60000" stroke="#fff" stroke-width="2"><title>'+p.date+': '+money(p.price)+'</title></circle>').join("");
    const labels=coords.map(p=>'<text x="'+p.x+'" y="'+(height-5)+'" text-anchor="middle" font-size="9" fill="#999">'+p.date.slice(5)+'</text>').join("");
    const grid=[0,1,2].map(i=>{const y=pad+i*(height-2*pad)/2;return '<line x1="'+pad+'" x2="'+(width-pad)+'" y1="'+y+'" y2="'+y+'" stroke="#eee" stroke-dasharray="3 4"/>';}).join("");
    $("historyChart").innerHTML='<svg viewBox="0 0 '+width+' '+height+'" role="img" aria-label="سجل أسعار '+escapeHtml(series.title)+'">'+grid+'<path d="'+path+'" fill="none" stroke="#e60000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'+circles+labels+'</svg>';
    $("historyCount").textContent=points.length+" / "+minRequired+" قراءات";
    $("historyNote").textContent=series.note || "سجل أسعار مرجعي؛ ليس بثاً مباشراً.";
    if (points.length < minRequired) {
      $("trendReadiness").textContent="لدينا "+points.length+" قراءات فقط من أصل "+minRequired+" مطلوبة للاتجاه الإحصائي. المحاكي أدناه يسمح باختبار افتراضاتك، لكنه لا يدّعي التنبؤ.";
    } else {
      const first=points[0],last=points[points.length-1];
      const change=((last.price/first.price)-1)*100;
      $("trendReadiness").textContent="تتوفر "+points.length+" قراءات. الاتجاه التاريخي من أول قراءة لآخر قراءة: "+percent(change)+". يعرض ذلك اتجاهاً وصفياً فقط، وليس ضماناً للسعر القادم.";
    }
  }

  function renderScenario() {
    const selected = products.find(p=>String(p.id)===$("forecastProductSelect").value);
    if (!selected) return;
    const fx=Number($("fxChange").value);
    const supply=Number($("supplyChange").value);
    const promo=Number($("promoChange").value);
    const horizon=$("forecastHorizon").value;
    const passThrough=0.65;
    const totalPct=(fx*passThrough)+supply-promo;
    const projected=Number(selected.price)*(1+totalPct/100);
    $("fxChangeValue").textContent=percent(fx);
    $("supplyChangeValue").textContent=percent(supply);
    $("promoChangeValue").textContent=percent(promo);
    $("scenarioPrice").textContent=money(projected);
    $("scenarioDelta").textContent=percent(totalPct)+" مقابل سعر الأساس الحالي ("+money(selected.price)+") — أفق السيناريو "+horizon+" يوم";
    $("scenarioFormula").textContent="المعادلة التوضيحية: السعر الحالي × [1 + (تغير الدولار × 65% تمرير افتراضي) + ضغط المعروض − الخصم المفترض]. نسبة 65% افتراض قابل للتغيير مستقبلاً بعد جمع بيانات فعلية؛ النتيجة ليست توقعاً إحصائياً ولا توصية شراء.";
    drawHistory(selected.id);
  }

  async function init() {
    try {
      [marketData,historyData,products]=await Promise.all([
        readJson("data/market-comparisons.json"),
        readJson("data/price-history.json"),
        readJson("data/products.json")
      ]);
      $("marketProductSelect").innerHTML=marketData.comparisons.map(x=>'<option value="'+escapeHtml(x.product_id)+'">'+escapeHtml(x.title+' — '+x.variant)+'</option>').join("");
      $("forecastProductSelect").innerHTML=products.filter(p=>p.category==="هواتف" && Number(p.price)>0).map(p=>'<option value="'+escapeHtml(p.id)+'">'+escapeHtml(p.name_ar+' — '+p.variant)+'</option>').join("");
      $("marketProductSelect").addEventListener("change",renderComparison);
      $("forecastProductSelect").addEventListener("change",renderScenario);
      ["fxChange","supplyChange","promoChange","forecastHorizon"].forEach(id=>$(id).addEventListener("input",renderScenario));
      $("resetScenario").addEventListener("click",()=>{
        $("fxChange").value=0;$("supplyChange").value=0;$("promoChange").value=0;$("forecastHorizon").value="30";renderScenario();
      });
      renderComparison();
      renderScenario();
    } catch (error) {
      console.error("Market intelligence unavailable:",error);
      $("marketSummary").innerHTML='<div class="metric-card"><b>تعذر تحميل بيانات المقارنة</b><span>تأكد من ملفات بيانات التحليل ثم أعد تحميل الصفحة.</span></div>';
      $("historyChart").textContent="تعذر تحميل سجل الأسعار.";
    }
  }

  init();
})();