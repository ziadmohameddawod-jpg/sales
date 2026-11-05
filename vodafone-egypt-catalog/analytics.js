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

    const exactOffers = record.offers.filter(x => !x.comparison_status || x.comparison_status === "same_core_variant");
    const otherVariants = record.offers.filter(x => x.comparison_status && x.comparison_status !== "same_core_variant");
    const prices = exactOffers.map(x => Number(x.price)).filter(x => Number.isFinite(x) && x > 0);
    const marketMedian = median(prices);
    const activeOffers = exactOffers.filter(x => x.status === "in_stock" && Number(x.price) > 0);
    const activePrices = activeOffers.map(x => Number(x.price));
    const lowestAvailable = activePrices.length ? Math.min(...activePrices) : null;
    const trackerPrice = Number(record.vodafone_tracker_price);
    const catalogPrice = Number(record.vodafone_catalog_price);
    const vodafonePrice = Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice :
      (Number.isFinite(trackerPrice) && trackerPrice > 0 ? trackerPrice : null);
    const vodafoneUnavailable = String(record.vodafone_status || "").includes("sold_out");
    const vsMedian = (vodafonePrice && marketMedian) ? ((vodafonePrice / marketMedian) - 1) * 100 : null;
    const gapToAvailable = (vodafonePrice && lowestAvailable) ? lowestAvailable - vodafonePrice : null;
    const soldOutCount = exactOffers.filter(x => x.status === "sold_out").length;

    $("marketSummary").innerHTML = [
      '<div class="metric-card"><small>أقل عرض متاح لنفس النسخة</small><b>'+(lowestAvailable === null ? "لا يوجد" : money(lowestAvailable))+'</b><span>'+(activeOffers.length ? activeOffers.length+" عرض متاح من "+exactOffers.length+" عروض متطابقة" : "لا توجد عروض متاحة مؤكدة في اللقطة")+'</span></div>',
      '<div class="metric-card"><small>وسيط آخر الأسعار المسجلة</small><b>'+money(marketMedian)+'</b><span>'+exactOffers.length+" أسعار متطابقة؛ منها "+soldOutCount+" نفدت — لا تمثل كلها عروضاً قابلة للشراء.</span></div>',
      '<div class="metric-card highlight"><small>فودافون — آخر سعر مرصود</small><b>'+(vodafonePrice === null ? "غير متاح" : money(vodafonePrice))+'</b><span>'+(vodafoneUnavailable ? "آخر رصد: غير متوفر بالمخزون" : record.vodafone_status_label || "حالة التوفر تحتاج تأكيداً")+(vsMedian === null ? "" : " · "+(vsMedian >= 0 ? "أعلى من الوسيط " : "أقل من الوسيط ")+Math.abs(vsMedian).toFixed(1)+"%")+'</span></div>'
    ].join("");

    $("marketVariant").textContent = record.variant;
    $("marketAsOf").textContent = "آخر فحص للمقارنة: " + record.as_of;
    let rows = exactOffers.map(x=>({
      store:x.store,price:Number(x.price),tag:(x.status==="in_stock"?"متاح — ":"")+(x.status==="sold_out"?"نفد — ":"")+(x.warranty || "الضمان غير مؤكد"),
      kind:"market",status:x.status||"unknown"
    }));
    if (vodafonePrice !== null) rows.push({
      store:"Vodafone Egypt — آخر رصد",price:vodafonePrice,
      tag:vodafoneUnavailable ? "آخر سعر معروف — غير متوفر" : (record.vodafone_status_label||"تحقق من السعر والتوفر"),
      kind:"direct",status:vodafoneUnavailable?"sold_out":"unknown"
    });
    rows.sort((a,b)=>a.price-b.price);
    const rowHtml = row => {
      const statusText = row.status === "in_stock" ? "متاح وقت الفحص" :
        row.status === "sold_out" ? "آخر سعر — نفد المخزون" :
        "حالة المخزون غير مؤكدة";
      const tagClass = row.kind === "direct" ? "direct" : row.status === "in_stock" ? "reported" : "";
      return '<tr class="'+(row.kind==="direct"?"vodafone-row":"")+(row.price===lowestAvailable && row.status==="in_stock"?" market-low":"")+'"><td>'+escapeHtml(row.store)+'</td><td>'+money(row.price)+'</td><td><span class="row-tag '+tagClass+'">'+escapeHtml(statusText+" · "+row.tag)+'</span></td></tr>';
    };
    const otherRows = otherVariants.map(x=>({
      store:x.store,price:Number(x.price),tag:x.variant_note||"نسخة مختلفة لا تدخل في المقارنة الأساسية",
      kind:"different",status:x.status||"unknown"
    }));
    $("marketRows").innerHTML = rows.map(rowHtml).join("") +
      (otherRows.length ? '<tr><td colspan="3" style="background:#fafafa;color:#999;font-size:8px">عروض نسخ مختلفة — مستبعدة من الحساب</td></tr>'+otherRows.map(x=>'<tr><td>'+escapeHtml(x.store)+'</td><td>'+money(x.price)+'</td><td><span class="row-tag">'+escapeHtml(x.tag)+'</span></td></tr>').join("") : "");
    const gapText = gapToAvailable === null ? "لا توجد مقارنة قابلة للشراء حالياً" :
      (gapToAvailable >= 0 ? "أقل سعر فودافون المرجعي من أقل عرض متاح بـ " : "آخر سعر فودافون المرجعي أعلى من أقل عرض متاح بـ ") + money(Math.abs(gapToAvailable));
    $("marketSourceNote").textContent = record.source_note + " " + gapText +
      (record.excluded_offers?.length ? " عروض مستبعدة بسبب اختلاف النسخة/الضمان: "+record.excluded_offers.map(x=>x.store+" ("+x.reason+")").join("؛ ") : "");
    $("marketSourceLinks").innerHTML =
      '<a href="'+escapeHtml(record.tracker_source)+'" target="_blank" rel="noopener">مصدر مقارنة السوق ↗</a>' +
      '<a href="'+escapeHtml(record.vodafone_source)+'" target="_blank" rel="noopener">صفحة فودافون ↗</a>';
  }

  function regressionForecast(points, days) {
    const xs=points.map(p=>Date.parse(p.date+"T00:00:00Z")/86400000);
    const ys=points.map(p=>Math.log(Number(p.price)));
    const n=xs.length;
    const meanX=xs.reduce((a,b)=>a+b,0)/n;
    const meanY=ys.reduce((a,b)=>a+b,0)/n;
    const sxx=xs.reduce((sum,x)=>sum+(x-meanX)**2,0);
    if (!sxx || n<3) return null;
    const slope=xs.reduce((sum,x,i)=>sum+(x-meanX)*(ys[i]-meanY),0)/sxx;
    const intercept=meanY-slope*meanX;
    const residuals=xs.map((x,i)=>ys[i]-(intercept+slope*x));
    const variance=residuals.reduce((sum,r)=>sum+r*r,0)/Math.max(1,n-2);
    const lastX=xs[xs.length-1];
    const targetX=lastX+days;
    const predicted=Math.exp(intercept+slope*targetX);
    const standardError=Math.sqrt(variance*(1+1/n+((targetX-meanX)**2/sxx)));
    const low=Math.exp(intercept+slope*targetX-1.96*standardError);
    const high=Math.exp(intercept+slope*targetX+1.96*standardError);
    const observedChange=(Math.exp(slope*(lastX-xs[0]))-1)*100;
    return {predicted,low,high,observedChange,weeklyTrend:(Math.exp(slope*7)-1)*100};
  }

  function drawHistory(productId,horizon) {
    const series = historyData.series.find(x => x.product_id === productId);
    const minRequired = historyData.required_observations_for_trend || 8;
    $("trendEstimate").hidden=true;
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
      return;
    }
    const estimate=regressionForecast(points,Number(horizon)||30);
    if (!estimate) {
      $("trendReadiness").textContent="البيانات المتاحة لا تكفي لحساب اتجاه زمني مستقر.";
      return;
    }
    $("trendReadiness").textContent="تتوفر "+points.length+" قراءات. تغير السعر عبر فترة الرصد: "+percent(estimate.observedChange)+"؛ الاتجاه الأسبوعي الخطي: "+percent(estimate.weeklyTrend)+".";
    $("trendEstimate").hidden=false;
    $("trendEstimate").innerHTML='<b>استقراء اتجاه تجريبي لـ '+escapeHtml(horizon)+' يوم</b><strong>'+money(estimate.predicted)+'</strong><span>نطاق النموذج التقريبي: '+money(estimate.low)+' – '+money(estimate.high)+'</span><small>انحدار لوغاريتمي على السجل المتاح مع نطاق تنبؤ تقريبي. هذا النموذج لا يلتقط تلقائياً قرارات الاستيراد أو تغير العملة المفاجئ أو العروض؛ لا تعتبره ضماناً.</small>';
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
    drawHistory(selected.id,horizon);
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