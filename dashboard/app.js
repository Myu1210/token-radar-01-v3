// Token Launch Radar v3 (radar-4) — renders window.RADAR: method panel, board,
// detail view, live-token table. No network: all data comes from data.js.
(function () {
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows, stats = D.stats;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + Math.round(n);
  }
  function moneyFull(n) { return "$" + Math.round(n).toLocaleString("en-US"); }
  function pct(n) { return (n > 0 ? "+" : "") + n.toFixed(1) + "%"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- header + method panel ----
  $("asof").textContent = D.asOf;
  $("asof2").textContent = D.asOf;
  $("totalImplied").textContent = money(rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0));
  $("rowCount").textContent = rows.length;
  $("liveCount").textContent = stats.nComps;
  $("statA").textContent = stats.intercept.toFixed(4);
  $("statA2").textContent = stats.intercept.toFixed(4);
  $("statBeta").textContent = stats.beta.toFixed(4);
  $("statBeta2").textContent = stats.beta.toFixed(4);
  $("statLoo").textContent = stats.looModel.toFixed(2) + "x";
  $("statLoo2").textContent = stats.looModel.toFixed(2) + "x";
  $("statFlat").textContent = stats.looFlat.toFixed(2) + "x";
  $("statFlat2").textContent = stats.looFlat.toFixed(2) + "x";
  $("statWithin").textContent = stats.within3xPct.toFixed(1) + "%";
  $("statWithin2").textContent = stats.within3xPct.toFixed(1) + "%";
  $("statWithinLoo").textContent = stats.within3xLooPct.toFixed(1) + "%";
  $("statN").textContent = stats.nComps;

  // ---- benchmark table ----
  var benchBody = document.querySelector("#benchTable tbody");
  benchBody.innerHTML = stats.offsets.map(function (o) {
    return "<tr><td>" + esc(o.category) + "</td><td>" + o.n + "</td><td>" +
      (o.medianResidual >= 0 ? "+" : "") + o.medianResidual.toFixed(2) + "</td><td>" +
      (o.offset >= 0 ? "+" : "") + o.offset.toFixed(2) + "</td><td>×" +
      o.multiplier.toFixed(2) + "</td></tr>";
  }).join("");

  // ---- moving fastest (winsorised growth) ----
  var fast = rows.slice().sort(function (a, b) { return b.growth_pct - a.growth_pct; }).slice(0, 5);
  $("fastChips").innerHTML = fast.map(function (r) {
    return '<span class="chip">' + esc(r.name) + ' <b>' + pct(r.growth_pct) + '</b></span>';
  }).join("");

  // ---- category filter options ----
  var cats = {};
  rows.forEach(function (r) { if (r.category) cats[r.category] = 1; });
  var catSel = $("cat");
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  function capitalFor(tvl) {
    if (tvl < 25e6) return 50;
    if (tvl < 100e6) return 100;
    if (tvl < 1e9) return 150;
    if (tvl < 5e9) return 250;
    return 500;
  }
  function holdFor(ageDays) {
    if (ageDays !== null && ageDays < 180) return 60;
    if (ageDays !== null && ageDays < 365) return 45;
    return 30;
  }
  function farmShort(r) {
    var verb = "Deposit";
    var c = (r.category || "").toLowerCase();
    if (c.indexOf("lending") >= 0 || c.indexOf("collateral market") >= 0) verb = "Supply";
    else if (c.indexOf("prediction") >= 0) verb = "Fund account";
    else if (c.indexOf("curator") >= 0 || c.indexOf("allocator") >= 0) verb = "Vault";
    else if (c.indexOf("dex") >= 0 || c.indexOf("yield") >= 0) verb = "Add liquidity";
    else if (c.indexOf("perps") >= 0 || c.indexOf("derivative") >= 0 || c.indexOf("basis") >= 0) verb = "Margin";
    else if (c.indexOf("staking") >= 0 || c.indexOf("restaking") >= 0) verb = "Stake";
    var chain = (r.chains && r.chains[0]) || "Ethereum";
    return verb + " " + chain + " from $" + capitalFor(r.tvl_usd) + " · " + holdFor(r.age_days) + "d hold";
  }

  // ---- board ----
  var tbody = document.querySelector("#board tbody");
  function currentRows() {
    var q = $("q").value.trim().toLowerCase();
    var cat = catSel.value;
    var watchOnly = $("watchOnly").checked;
    var list = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var sort = $("sort").value;
    var key = { value: "implied_value_usd", tvl: "tvl_usd", growth: "growth_pct", heat: "heat", multiple: "multiple", age: "age_years" }[sort];
    list.sort(function (a, b) { return (b[key] || 0) - (a[key] || 0); });
    return list;
  }
  function renderBoard() {
    var list = currentRows();
    $("shownCount").textContent = list.length + " of " + rows.length + " rows";
    tbody.innerHTML = list.map(function (r) {
      var g = r.growth_pct;
      var gCls = g > 0 ? "up" : g < 0 ? "down" : "";
      var hCls = r.heat >= 60 ? "hot" : r.heat >= 40 ? "warm" : "";
      return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td><td><b>' + esc(r.name) + '</b>' +
        (r.watchlist ? '<span class="badge">WATCH</span>' : '') + '<br><span class="fine">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || "—") + '</td><td>' + esc((r.chains || []).slice(0, 2).join(", ")) +
        ((r.chains || []).length > 2 ? " +" + (r.chains.length - 2) : "") + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + gCls + '">' + pct(g) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">×' + r.multiple.toFixed(2) + '</td>' +
        '<td class="num">×' + r.category_multiplier.toFixed(2) + '</td>' +
        '<td class="num">' + (r.age_years === null ? "?" : r.age_years.toFixed(1) + "y") + '</td>' +
        '<td>' + esc(farmShort(r)) + '</td>' +
        '<td class="num">$' + r.per_1k.toFixed(0) + '</td>' +
        '<td class="num heat ' + hCls + '">' + r.heat + '</td></tr>';
    }).join("");
  }
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    document.querySelectorAll("#board tbody tr").forEach(function (tr) {
      tr.classList.toggle("sel", tr.getAttribute("data-slug") === slug);
    });
    var d = $("detail");
    d.hidden = false;
    $("dName").textContent = "#" + r.rank + " " + r.name + (r.watchlist ? " — on the watchlist" : "");
    $("dMeta").textContent = (r.category || "No category") + " · " + (r.chains || []).join(", ") +
      " · listed " + (r.listed_at || "unknown") + " · " + (r.age_years === null ? "age unknown" : r.age_years.toFixed(1) + " years with no token recorded");
    $("dImplied").textContent = moneyFull(r.implied_value_usd);
    $("dTvl").textContent = moneyFull(r.tvl_usd);
    $("dMult").textContent = "×" + r.multiple.toFixed(3);
    $("dBench").textContent = "×" + r.category_multiplier.toFixed(2) + " (" + r.category_n + (r.category_n === 1 ? " live comp" : " live comps") +
      (r.category_median_residual === null ? ", no live comps" : ", median residual " + (r.category_median_residual >= 0 ? "+" : "") + r.category_median_residual.toFixed(2) + " dex") + ")";
    $("dGrowth").textContent = pct(r.growth_pct) + " (×" + r.growth_multiplier.toFixed(2) + ")";
    $("dAge").textContent = (r.age_years === null ? "unknown" : r.age_years.toFixed(1) + "y") + " (×" + r.age_multiplier.toFixed(2) + ")";
    $("dModel").textContent = "Model: 10^(" + stats.intercept.toFixed(4) + " + " + stats.beta.toFixed(4) +
      " · log10(" + moneyFull(r.tvl_usd) + ")" + (r.category_offset >= 0 ? " + " : " − ") + Math.abs(r.category_offset).toFixed(2) +
      ") × " + r.growth_multiplier.toFixed(2) + " growth × " + r.age_multiplier.toFixed(2) +
      " maturity. HEAT " + r.heat + " = 50% winsorised growth + 30% multiple + 20% recency.";
    $("dSteps").innerHTML = r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    if (!shotMode) d.scrollIntoView();
  }
  tbody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });
  ["q", "cat", "watchOnly", "sort"].forEach(function (id) {
    $(id).addEventListener("input", renderBoard);
    $(id).addEventListener("change", renderBoard);
  });

  // ---- live-token table ----
  var liveBody = document.querySelector("#liveTable tbody");
  liveBody.innerHTML = D.liveTop.map(function (p) {
    return "<tr><td><b>" + esc(p.name) + "</b><br><span class='fine'>" + esc(p.slug) + "</span></td><td>" +
      esc(p.category || "—") + "</td><td class='num'>" + money(p.tvl_usd) + "</td><td class='num'>" +
      money(p.mcap_usd) + "</td><td class='num'>×" + (p.mcap_usd / p.tvl_usd).toFixed(2) + "</td></tr>";
  }).join("");

  // ---- URL params (for screenshots): ?cat=, ?q=, ?slug= ----
  // ?shot=detail renders the detail view alone at the top of the page, so a
  // headless screenshot needs no scrolling to find it.
  var params = new URLSearchParams(window.location.search);
  var shotMode = params.get("shot") === "detail";
  if (params.get("cat")) { catSel.value = params.get("cat"); }
  if (params.get("q")) { $("q").value = params.get("q"); }
  if (params.get("watch")) { $("watchOnly").checked = true; }
  renderBoard();
  if (params.get("slug")) {
    showDetail(params.get("slug"));
    if (shotMode) {
      ["method", "fast"].forEach(function (id) { $(id).style.display = "none"; });
      document.querySelector(".controls").style.display = "none";
      document.querySelector("main").style.display = "none";
      document.querySelector(".live").style.display = "none";
      document.querySelector("footer").style.display = "none";
    }
  }
})();
