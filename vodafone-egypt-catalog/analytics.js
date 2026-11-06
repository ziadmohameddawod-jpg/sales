(() => {
  const $ = (id) => document.getElementById(id);
  const money = (value) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(Math.round(Number(value))) + " ج.م";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  let marketData = null;
  let historyData = null;
  let products = [];
  const ALL_PRODUCTS = "__ALL_PRODUCTS__";

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

  function draw48Hour(productId) {
    const minRequired=historyData.short_term_forecast_requirements?.min_daily_observations||90;
    const store=$("forecastStoreSelect").value||"Vodafone Egypt";
    const series=(historyData.daily_series||[]).find(item=>item.product_id===productId&&item.store===store);
    const points=(series?.observations||[]).filter(point=>Number(point.price)>0&&/^\d{4}-\d{2}-\d{2}$/.test(point.date)).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const distinct=[...new Map(points.map(point=>[point.date,point])).values()];
    if(distinct.length<minRequired){
      $("forecast48h").innerHTML='<b>توقع 48 ساعة غير متاح</b><span>سجل '+escapeHtml(store)+' لهذا الموديل يحتوي '+distinct.length+' من '+minRequired+' قراءة يومية مطلوبة. نحتاج ملاحظات متتابعة لنفس النسخة والمتجر.</span><small>لا نصدر توقعاً أو احتمالاً رقمياً قبل اكتمال السجل والاختبار الرجعي.</small>';
      return;
    }
    const day=86400000;
    const windows=[];
    for(let i=0;i<distinct.length-2;i+=2){
      const start=distinct[i],end=distinct[i+2];
      if(Date.parse(end.date+"T00:00:00Z")-Date.parse(start.date+"T00:00:00Z")!==2*day)continue;
      const label=Number(end.price)>Number(start.price)?"increase":Number(end.price)<Number(start.price)?"decrease":"steady";
      windows.push({startIndex:i,endIndex:i+2,startDate:start.date,label});
    }
    if(windows.length<30){
      $("forecast48h").innerHTML='<b>لا توجد نوافذ 48 ساعة كافية للاختبار</b><span>اكتملت '+distinct.length+' قراءة يومية، لكن السجل يحتوي '+windows.length+' نافذة متتابعة فقط.</span><small>أكمل ملاحظات يومية متصلة للـ SKU والمتجر نفسيهما.</small>';
      return;
    }
    const split=Math.ceil(windows.length*.75),holdout=windows.slice(split),results=[];
    holdout.forEach(test=>{
      const training=windows.filter(window=>window.endIndex<test.startIndex);
      if(training.length<10)return;
      const counts={increase:0,decrease:0,steady:0};
      training.forEach(window=>counts[window.label]++);
      const prediction=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      results.push({prediction,actual:test.label});
    });
    if(results.length<10){
      $("forecast48h").innerHTML='<b>الاختبار الرجعي غير كافٍ بعد</b><span>نحتاج 10 فترات اختبار غير متداخلة على الأقل بعد تقسيم زمني يحافظ على ترتيب التاريخ؛ وقد تظل النتائج مترابطة بمرور الوقت.</span>';
      return;
    }
    const correct=results.filter(result=>result.prediction===result.actual).length;
    const accuracy=correct/results.length*100;
    const noChangeBaseline=results.filter(result=>result.actual==="steady").length/results.length*100;
    const allCounts={increase:0,decrease:0,steady:0};
    windows.forEach(window=>allCounts[window.label]++);
    const direction=Object.keys(allCounts).sort((a,b)=>allCounts[b]-allCounts[a])[0];
    const names={increase:"زيادة",decrease:"انخفاض",steady:"استقرار"};
    const testSummary='اختبار زمني خارج العينة: '+correct+'/'+results.length+' ('+accuracy.toFixed(1)+'%)؛ خط أساس «لا تغير» '+noChangeBaseline.toFixed(1)+'%. ';
    const passes=accuracy>noChangeBaseline;
    $("forecast48h").innerHTML='<b>'+(passes?'اتجاه تجريبي وفق السجل: '+names[direction]:'لا يعرض النموذج توقعاً اتجاهياً')+'</b><span>'+testSummary+(passes?'النموذج تجاوز خط الأساس في هذا الاختبار المحدود.':'لم يتجاوز النموذج خط الأساس؛ يلزم جمع بيانات ومراجعة المنهج قبل استخدامه.')+'</span><small>'+distinct.length+' قراءة لنفس المنتج والمتجر؛ '+windows.length+' فترة 48 ساعة غير متداخلة. قد تظل النتائج مترابطة زمنياً. لا تُعرض احتمالات رقمية قبل اختبار المعايرة.</small>';
  }

  function productHistoryStats(productId, store) {
    const weekly = (historyData.series || []).find(item => item.product_id === productId);
    const weeklyPoints = (weekly?.observations || []).filter(point =>
      Number(point.price) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(point.date)
    ).slice().sort((a,b)=>a.date.localeCompare(b.date));
    const daily = (historyData.daily_series || []).find(item =>
      item.product_id === productId && item.store === store
    );
    const dailyPoints = [...new Map((daily?.observations || [])
      .filter(point => Number(point.price) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(point.date))
      .map(point => [point.date, point])).values()].sort((a,b)=>a.date.localeCompare(b.date));
    return {weeklyPoints, dailyPoints};
  }

  function assess48HourForecast(productId, store) {
    const minRequired = historyData.short_term_forecast_requirements?.min_daily_observations || 90;
    const stats = productHistoryStats(productId, store);
    const dailyPoints = stats.dailyPoints;
    if (dailyPoints.length < minRequired) {
      return {ready:false, label:"غير متاح · "+dailyPoints.length+"/"+minRequired, detail:"قراءات يومية مطلوبة لنفس المنتج والمتجر"};
    }
    const day = 86400000;
    const windows = [];
    for (let i=0; i<dailyPoints.length-2; i+=2) {
      const first=dailyPoints[i], last=dailyPoints[i+2];
      if (Date.parse(last.date+"T00:00:00Z")-Date.parse(first.date+"T00:00:00Z")!==2*day) continue;
      const label=Number(last.price)>Number(first.price)?"increase":Number(last.price)<Number(first.price)?"decrease":"steady";
      windows.push({startIndex:i,endIndex:i+2,label});
    }
    if (windows.length < 30) {
      return {ready:false,label:"غير متاح · نوافذ اختبار قليلة",detail:windows.length+" نافذة 48 ساعة؛ نحتاج 30 على الأقل"};
    }
    const split=Math.ceil(windows.length*.75), holdout=windows.slice(split), results=[];
    holdout.forEach(test=>{
      const training=windows.filter(window=>window.endIndex<test.startIndex);
      if(training.length<10)return;
      const counts={increase:0,decrease:0,steady:0};
      training.forEach(window=>counts[window.label]++);
      const prediction=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
      results.push({prediction,actual:test.label});
    });
    if(results.length<10) return {ready:false,label:"غير متاح · اختبار رجعي محدود",detail:results.length+" نتيجة اختبار فقط؛ نحتاج 10 على الأقل"};
    const correct=results.filter(result=>result.prediction===result.actual).length;
    const accuracy=correct/results.length*100;
    const baseline=results.filter(result=>result.actual==="steady").length/results.length*100;
    const counts={increase:0,decrease:0,steady:0};
    windows.forEach(window=>counts[window.label]++);
    const direction=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
    const names={increase:"زيادة",decrease:"انخفاض",steady:"استقرار"};
    const passes=accuracy>baseline;
    return {ready:passes,label:passes?"اتجاه تجريبي · "+names[direction]:"لم يجتز خط الأساس",
      detail:"اختبار خارج العينة "+correct+"/"+results.length+" ("+accuracy.toFixed(1)+"%) مقابل خط أساس "+baseline.toFixed(1)+"%"};
  }

  function populateForecastStores() {
    const productId=$("forecastProductSelect").value;
    const series=(historyData.daily_series||[]).filter(item =>
      productId===ALL_PRODUCTS || item.product_id===productId
    );
    const stores=[...new Set(series.map(item=>item.store).filter(Boolean))];
    if(!stores.includes("Vodafone Egypt")) stores.unshift("Vodafone Egypt");
    const previous=$("forecastStoreSelect").value;
    $("forecastStoreSelect").innerHTML=stores.map(store=>'<option value="'+escapeHtml(store)+'">'+escapeHtml(store)+'</option>').join("");
    $("forecastStoreSelect").value=stores.includes(previous)?previous:"Vodafone Egypt";
  }

  function populateBulkBrands() {
    const category=$("forecastCategoryFilter").value || "الكل";
    const previous=$("forecastBrandFilter").value || "الكل";
    const brands=[...new Set(products
      .filter(product=>category==="الكل" || product.category===category)
      .map(product=>product.brand))].sort((a,b)=>a.localeCompare(b,"ar"));
    $("forecastBrandFilter").innerHTML=['<option value="الكل">كل الماركات</option>',...brands.map(brand=>'<option value="'+escapeHtml(brand)+'">'+escapeHtml(brand)+'</option>')].join("");
    $("forecastBrandFilter").value=brands.includes(previous)?previous:"الكل";
  }

  function populateBulkFilters() {
    const categories=[...new Set(products.map(product=>product.category))].sort((a,b)=>a.localeCompare(b,"ar"));
    $("forecastCategoryFilter").innerHTML=['<option value="الكل">كل الفئات</option>',...categories.map(category=>'<option value="'+escapeHtml(category)+'">'+escapeHtml(category)+'</option>')].join("");
    populateBulkBrands();
  }

  function renderBulkResults(totalPct) {
    const category=$("forecastCategoryFilter").value || "الكل";
    const brand=$("forecastBrandFilter").value || "الكل";
    const query=String($("forecastSearchFilter").value||"").trim().toLocaleLowerCase("ar");
    const store=$("forecastStoreSelect").value || "Vodafone Egypt";
    const weeklyRequired=Number(historyData.required_observations_for_trend||8);
    const dailyRequired=Number(historyData.short_term_forecast_requirements?.min_daily_observations||90);
    const results=products.filter(product=>{
      const searchable=[product.name_ar,product.brand,product.category,product.variant].join(" ").toLocaleLowerCase("ar");
      return (category==="الكل" || product.category===category) &&
        (brand==="الكل" || product.brand===brand) &&
        (!query || searchable.includes(query)) &&
        Number(product.price)>0;
    }).sort((a,b)=>a.category.localeCompare(b.category,"ar") ||
      a.brand.localeCompare(b.brand,"ar") || a.name_ar.localeCompare(b.name_ar,"ar") ||
      String(a.variant).localeCompare(String(b.variant),"ar"));

    $("scenarioBulkCount").textContent=results.length.toLocaleString("ar-EG")+" من "+products.length.toLocaleString("ar-EG")+" منتج";
    $("scenarioBulkBody").innerHTML=results.map(product=>{
      const base=Number(product.price), projected=base*(1+totalPct/100), delta=projected-base;
      const stats=productHistoryStats(product.id,store);
      const assessment=assess48HourForecast(product.id,store);
      const statusLabel=product.status==="in"?"متاح وقت الرصد":product.status==="limited"?"مخزون محدود":product.status==="out"?"آخر رصد: غير متاح":"التوفر يحتاج مراجعة";
      const deltaClass=delta>0?"up":delta<0?"down":"flat";
      const forecastClass=assessment.ready?"ready":"pending";
      return '<tr><td><b>'+escapeHtml(product.name_ar)+'</b><small>'+escapeHtml(product.brand)+' · '+escapeHtml(product.category)+' · '+escapeHtml(product.variant)+'</small><small>'+escapeHtml(statusLabel)+' · آخر رصد '+escapeHtml(product.source_checked_at||"غير محدد")+'</small></td>'+
        '<td>'+money(base)+'</td><td class="scenario-price-cell">'+money(projected)+'</td>'+
        '<td><span class="scenario-delta '+deltaClass+'">'+percent(totalPct)+'</span><small>'+money(Math.abs(delta))+'</small></td>'+
        '<td>'+stats.weeklyPoints.length+'/'+weeklyRequired+'</td><td>'+stats.dailyPoints.length+'/'+dailyRequired+'</td>'+
        '<td><span class="scenario-status '+forecastClass+'">'+escapeHtml(assessment.label)+'</span><small>'+escapeHtml(assessment.detail)+'</small></td></tr>';
    }).join("");
    $("scenarioBulkNote").textContent="النتائج تعرض سعر الأساس المسجل لكل منتج وتطبيق الافتراضات نفسها عليه. السجل الأسبوعي واليومي منفصل لكل SKU ومتجر؛ لا يتم تعميم تاريخ موديل على آخر. الأسعار المرجعية قد تكون آخر سعر معروف حتى لو المنتج غير متاح حالياً.";
    if(!results.length) $("scenarioBulkBody").innerHTML='<tr><td colspan="7" class="bulk-empty">لا توجد منتجات مطابقة للفلاتر الحالية.</td></tr>';
  }

  function drawAllProductsHistory() {
    const store=$("forecastStoreSelect").value || "Vodafone Egypt";
    const weeklyKnown=products.filter(product=>productHistoryStats(product.id,store).weeklyPoints.length>0).length;
    const weeklyReady=products.filter(product=>productHistoryStats(product.id,store).weeklyPoints.length>=(historyData.required_observations_for_trend||8)).length;
    const dailyKnown=products.filter(product=>productHistoryStats(product.id,store).dailyPoints.length>0).length;
    const dailyReady=products.filter(product=>productHistoryStats(product.id,store).dailyPoints.length>=(historyData.short_term_forecast_requirements?.min_daily_observations||90)).length;
    $("historyCount").textContent=weeklyKnown+" / "+products.length+" لها سجل أسبوعي";
    $("historyChart").innerHTML='<div class="history-overview">'+
      '<div><b>'+products.length.toLocaleString("ar-EG")+'</b><small>منتج داخل المحاكي</small></div>'+
      '<div><b>'+weeklyKnown.toLocaleString("ar-EG")+'</b><small>لها سجل أسبوعي</small></div>'+
      '<div><b>'+weeklyReady.toLocaleString("ar-EG")+'</b><small>مكتمل 8 قراءات أسبوعية</small></div>'+
      '<div><b>'+dailyKnown.toLocaleString("ar-EG")+'</b><small>لها قراءة يومية لدى '+escapeHtml(store)+'</small></div>'+
      '<div><b>'+dailyReady.toLocaleString("ar-EG")+'</b><small>مكتمل 90 قراءة يومية</small></div></div>';
    $("historyNote").textContent="كل منتج له سجل مستقل. وجود سعر حالي لا يعني وجود تاريخ كافٍ؛ لن نخلط تاريخ موديل بآخر أو متجر بآخر.";
    $("trendReadiness").textContent="المحاكي يطبق السيناريو على "+products.length+" منتجاً. يوجد سجل أسبوعي لـ "+weeklyKnown+" منتجاً، و"+weeklyReady+" فقط لديهم 8 قراءات. هذا لا يكفي وحده لتوقع 48 ساعة.";
    $("trendEstimate").hidden=true;
    $("forecast48h").innerHTML='<b>حالة التوقع الإحصائي حسب كل منتج</b><span>'+dailyKnown+' منتجاً لديهم قراءة يومية واحدة على الأقل لدى '+escapeHtml(store)+'، و'+dailyReady+' أكملوا 90 قراءة يومية. التفاصيل لكل منتج في جدول النتائج.</span><small>لا يوجد توقع موحد للكتالوج؛ كل توقع يجب أن يعتمد على سجل النسخة والمتجر نفسهما واختبار رجعي مستقل.</small>';
  }

  function renderComparison() {
    const selectedId = $("marketProductSelect").value;
    const product = products.find(item => item.id === selectedId);
    const record = marketData.comparisons.find(item => item.product_id === selectedId);
    if (!product) return;

    const offers = record?.offers || [];
    const exactOffers = offers.filter(item => !item.comparison_status || item.comparison_status === "same_core_variant");
    const otherVariants = offers.filter(item => item.comparison_status && item.comparison_status !== "same_core_variant");
    const prices = exactOffers.map(item => Number(item.price)).filter(value => Number.isFinite(value) && value > 0);
    const marketMedian = median(prices);
    const activeOffers = exactOffers.filter(item => item.status === "in_stock" && Number(item.price) > 0);
    const activePrices = activeOffers.map(item => Number(item.price));
    const lowestAvailable = activePrices.length ? Math.min(...activePrices) : null;
    const catalogPrice = Number(product.price);
    const vodafonePrice = Number.isFinite(catalogPrice) && catalogPrice > 0 ? catalogPrice : null;
    const vodafoneUnavailable = ["out","sold_out"].includes(String(product.status || "").toLowerCase());
    const vsMedian = vodafonePrice && marketMedian ? ((vodafonePrice / marketMedian) - 1) * 100 : null;
    const gapToAvailable = vodafonePrice && lowestAvailable ? lowestAvailable - vodafonePrice : null;
    const soldOutCount = exactOffers.filter(item => item.status === "sold_out").length;
    const unknownCount = exactOffers.filter(item => !["in_stock","sold_out"].includes(item.status)).length;
    const asOf = record?.as_of || product.source_checked_at || "غير محدد";

    $("marketSummary").innerHTML = [
      '<div class="metric-card"><small>أقل عرض متاح مؤكد لنفس النسخة</small><b>'+(lowestAvailable === null ? "لا يوجد تأكيد" : money(lowestAvailable))+'</b><span>'+(activeOffers.length ? activeOffers.length+" عرض متاح من "+exactOffers.length+" عروض مطابقة" : "لا توجد عروض مخزون مؤكدة؛ لا نعتبر السعر القديم متاحاً")+'</span></div>',
      '<div class="metric-card"><small>وسيط الأسعار المسجلة</small><b>'+money(marketMedian)+'</b><span>'+(exactOffers.length ? exactOffers.length+" أسعار مطابقة؛ "+soldOutCount+" نفدت و"+unknownCount+" مخزونها غير مؤكد" : "لا توجد لقطة أسعار منافسين لهذا المنتج")+'</span></div>',
      '<div class="metric-card highlight"><small>Vodafone Egypt — آخر سعر بالكتالوج</small><b>'+(vodafonePrice === null ? "غير مسجل" : money(vodafonePrice))+'</b><span>'+(vodafoneUnavailable ? "آخر رصد: غير متاح" : product.availability || "التوفر يحتاج تأكيداً")+(vsMedian === null ? "" : " · "+(vsMedian >= 0 ? "أعلى من الوسيط " : "أقل من الوسيط ")+Math.abs(vsMedian).toFixed(1)+"%")+'</span></div>'
    ].join("");

    $("marketVariant").textContent = product.variant || "النسخة غير محددة بالكامل";
    $("marketAsOf").textContent = "آخر رصد: "+asOf;
    let rows = exactOffers.map(item=>({
      store:item.store,price:Number(item.price),tag:item.warranty || item.condition || "الضمان غير مؤكد",
      kind:"market",status:item.status||"unknown",source:item.source_url||""
    }));
    if (vodafonePrice !== null) rows.push({
      store:"Vodafone Egypt — آخر رصد",price:vodafonePrice,
      tag:vodafoneUnavailable ? "آخر سعر معروف — غير متاح" : (product.availability||"تحقق من السعر والتوفر"),
      kind:"direct",status:vodafoneUnavailable?"sold_out":"unknown",source:product.product_url||product.source_url||""
    });
    rows.sort((a,b)=>a.price-b.price);
    const rowHtml = row => {
      const statusText = row.kind==="direct" ? (row.status==="sold_out"?"آخر سعر — غير متاح":"سعر الكتالوج — تحقق عند الشراء") :
        row.status === "in_stock" ? "متاح وقت الفحص" :
        row.status === "sold_out" ? "آخر سعر — نفد المخزون" : "المخزون غير مؤكد";
      const tagClass = row.kind === "direct" ? "direct" : row.status === "in_stock" ? "reported" : "";
      const difference = lowestAvailable === null ? '<span class="market-delta">لا يوجد عرض متاح مؤكد</span>' :
        row.price === lowestAvailable && row.status==="in_stock" ? '<span class="market-delta best">أقل عرض متاح</span>' :
        '<span class="market-delta">'+(row.price > lowestAvailable ? "+" : "−")+money(Math.abs(row.price-lowestAvailable))+' ('+percent((row.price/lowestAvailable-1)*100)+')</span>';
      const store = row.source ? '<a href="'+escapeHtml(row.source)+'" target="_blank" rel="noopener">'+escapeHtml(row.store)+' ↗</a>' : escapeHtml(row.store);
      return '<tr class="'+(row.kind==="direct"?"vodafone-row":"")+(row.price===lowestAvailable && row.status==="in_stock"?" market-low":"")+'"><td>'+store+'</td><td>'+money(row.price)+'</td><td><span class="row-tag '+tagClass+'">'+escapeHtml(statusText+" · "+row.tag)+'</span></td><td>'+difference+'</td></tr>';
    };
    const otherRows = otherVariants.map(item=>'<tr><td>'+escapeHtml(item.store)+'</td><td>'+money(item.price)+'</td><td><span class="row-tag">'+escapeHtml(item.variant_note||"نسخة مختلفة")+'</span></td><td><span class="market-delta">مستبعدة من المقارنة</span></td></tr>');
    const noOffers = !exactOffers.length ? '<tr><td colspan="4" class="market-empty">لا توجد عروض منافسين موثقة ومطابقة لهذه النسخة حتى الآن. سعر فودافون ظاهر كمرجع فقط؛ لا توجد مقارنة سوقية مكتملة.</td></tr>' : "";
    $("marketRows").innerHTML = noOffers + rows.map(rowHtml).join("") +
      (otherRows.length ? '<tr><td colspan="4" style="background:#fafafa;color:#999;font-size:8px">عروض نسخ مختلفة — مستبعدة من الحساب</td></tr>'+otherRows.join("") : "");
    const gapText = gapToAvailable === null ? "لا توجد مقارنة مؤكدة بعرض متاح حالياً" :
      (gapToAvailable >= 0 ? "سعر فودافون أقل من أقل عرض متاح بـ " : "سعر فودافون أعلى من أقل عرض متاح بـ ") + money(Math.abs(gapToAvailable));
    $("marketSourceNote").textContent = (record?.source_note || "لا توجد لقطة مقارنة منافسين محفوظة لهذا المنتج.")+" "+gapText;
    const links=[];
    if(record?.tracker_source)links.push('<a href="'+escapeHtml(record.tracker_source)+'" target="_blank" rel="noopener">مصدر لقطة السوق ↗</a>');
    const vodafoneSource=record?.vodafone_source||product.product_url||product.source_url;
    if(vodafoneSource)links.push('<a href="'+escapeHtml(vodafoneSource)+'" target="_blank" rel="noopener">صفحة Vodafone ↗</a>');
    $("marketSourceLinks").innerHTML=links.join("");
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
    draw48Hour(productId);
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

  function scenarioPercent() {
    return (Number($("fxChange").value)*0.65)+Number($("supplyChange").value)-
      Number($("promoChange").value)+Number($("priceChange").value);
  }

  function renderScenario() {
    const selectedId=$("forecastProductSelect").value;
    const fx=Number($("fxChange").value);
    const supply=Number($("supplyChange").value);
    const promo=Number($("promoChange").value);
    const direct=Number($("priceChange").value);
    const horizon=$("forecastHorizon").value;
    const totalPct=(fx*0.65)+supply-promo+direct;
    $("fxChangeValue").textContent=percent(fx);
    $("supplyChangeValue").textContent=percent(supply);
    $("promoChangeValue").textContent=percent(promo);
    $("priceChangeValue").textContent=percent(direct);

    if(selectedId===ALL_PRODUCTS){
      const count=products.filter(product=>Number(product.price)>0).length;
      $("scenarioBulkCard").hidden=false;
      $("scenarioPrice").textContent=count.toLocaleString("ar-EG")+" منتج";
      $("scenarioDelta").textContent=percent(totalPct)+" افتراض موحد مطبق على أسعار المنتجات · أفق "+horizon+" يوم";
      const weeklyReady=products.filter(product=>productHistoryStats(product.id,$("forecastStoreSelect").value).weeklyPoints.length>=(historyData.required_observations_for_trend||8)).length;
      const dailyReady=products.filter(product=>assess48HourForecast(product.id,$("forecastStoreSelect").value).ready).length;
      $("scenarioRank").textContent=weeklyReady+" منتج لديه سجل أسبوعي كافٍ · "+dailyReady+" اجتاز اختبار التوقع اليومي حالياً.";
      $("scenarioFormula").textContent="المعادلة التوضيحية لكل منتج: سعره الحالي × [1 + (تغير الدولار × 65% تمرير افتراضي) + ضغط المعروض − الخصم المفترض + التغيير المباشر]. هذه محاكاة افتراضية وليست توقعاً إحصائياً.";
      renderBulkResults(totalPct);
      drawAllProductsHistory();
      return;
    }

    $("scenarioBulkCard").hidden=true;
    const selected=products.find(product=>String(product.id)===selectedId);
    if(!selected)return;
    const projected=Number(selected.price)*(1+totalPct/100);
    $("scenarioPrice").textContent=money(projected);
    $("scenarioDelta").textContent=percent(totalPct)+" مقابل سعر الأساس الحالي ("+money(selected.price)+") — أفق السيناريو "+horizon+" يوم";
    const comparison=marketData.comparisons.find(record=>record.product_id===selected.id);
    const comparable=(comparison?.offers||[]).filter(offer=>(!offer.comparison_status||offer.comparison_status==="same_core_variant")&&offer.status==="in_stock"&&Number(offer.price)>0);
    const cheaper=comparable.filter(offer=>Number(offer.price)<projected).length;
    $("scenarioRank").textContent=comparable.length
      ? "ترتيب السعر الافتراضي: "+(cheaper+1)+" من "+(comparable.length+1)+" عروض متاحة في اللقطة المطابقة؛ هذا ترتيب حسابي وليس توصية شراء."
      : "لا توجد عروض متاحة مطابقة كافية لترتيب هذا السيناريو حالياً.";
    $("scenarioFormula").textContent="المعادلة التوضيحية: السعر الحالي × [1 + (تغير الدولار × 65% تمرير افتراضي) + ضغط المعروض − الخصم المفترض + التغيير المباشر]. نسبة 65% افتراض توضيحي؛ النتيجة ليست توقعاً إحصائياً ولا توصية شراء.";
    drawHistory(selected.id,horizon);
  }

  async function init() {
    try {
      [marketData,historyData,products]=await Promise.all([
        readJson("data/market-comparisons.json"),
        readJson("data/price-history.json"),
        readJson("data/products.json")
      ]);
      const marketSelectable=products.filter(product=>Number(product.price)>0).slice().sort((a,b)=>
        a.category.localeCompare(b.category,"ar") || a.brand.localeCompare(b.brand,"ar") ||
        a.name_ar.localeCompare(b.name_ar,"ar") || String(a.variant).localeCompare(String(b.variant),"ar"));
      const marketIds=new Set(marketData.comparisons.map(item=>item.product_id));
      $("marketProductSelect").innerHTML=marketSelectable.map(product=>{
        const hasOffers=marketIds.has(product.id) && (marketData.comparisons.find(item=>item.product_id===product.id)?.offers||[]).some(offer=>!offer.comparison_status||offer.comparison_status==="same_core_variant");
        return '<option value="'+escapeHtml(product.id)+'">'+escapeHtml(product.name_ar+' — '+product.variant+' · '+(hasOffers?'مقارنة مسجلة':'لا توجد عروض منافسين بعد'))+'</option>';
      }).join("");
      const preferred=marketSelectable.find(product=>marketIds.has(product.id));
      if(preferred)$("marketProductSelect").value=preferred.id;
      const withOffers=marketSelectable.filter(product=>(marketData.comparisons.find(item=>item.product_id===product.id)?.offers||[]).some(offer=>!offer.comparison_status||offer.comparison_status==="same_core_variant")).length;
      $("marketCoverage").textContent=withOffers+" من "+marketSelectable.length+" منتج لها عروض منافسين مسجلة؛ الباقي يظهر بسعر Vodafone فقط لحين توافر عروض مطابقة.";
      const selectable=products.filter(product=>Number(product.price)>0).slice().sort((a,b)=>
        a.category.localeCompare(b.category,"ar") || a.brand.localeCompare(b.brand,"ar") ||
        a.name_ar.localeCompare(b.name_ar,"ar") || String(a.variant).localeCompare(String(b.variant),"ar"));
      $("forecastProductSelect").innerHTML=
        '<option value="'+ALL_PRODUCTS+'">كل المنتجات ('+selectable.length+')</option>'+
        selectable.map(product=>'<option value="'+escapeHtml(product.id)+'">'+escapeHtml(product.name_ar+' — '+product.variant+' · '+product.category)+'</option>').join("");
      populateBulkFilters();
      $("marketProductSelect").addEventListener("change",renderComparison);
      $("forecastProductSelect").addEventListener("change",()=>{populateForecastStores();renderScenario();});
      $("forecastStoreSelect").addEventListener("change",renderScenario);
      $("forecastCategoryFilter").addEventListener("change",()=>{populateBulkBrands();renderBulkResults(scenarioPercent());});
      $("forecastBrandFilter").addEventListener("change",()=>renderBulkResults(scenarioPercent()));
      $("forecastSearchFilter").addEventListener("input",()=>renderBulkResults(scenarioPercent()));
      ["fxChange","supplyChange","promoChange","priceChange","forecastHorizon"].forEach(id=>$(id).addEventListener("input",renderScenario));
      $("resetScenario").addEventListener("click",()=>{
        $("fxChange").value=0;$("supplyChange").value=0;$("promoChange").value=0;$("priceChange").value=0;$("forecastHorizon").value="30";renderScenario();
      });
      populateForecastStores();
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
