// Register service worker (offline)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const CATEGORIES = [
  "Rent/Mortgage","Utilities","Groceries","Dining","Gas/Transport","Car",
  "Insurance","Medical","Subscriptions","Shopping","Entertainment","Travel",
  "Debt","Savings/Investing","Income","Transfer","Other"
];

const { openDB } = idb;

let db;
let pieExpensesChart, pieDepositsChart, pieRatioChart;
let parsedRows = []; // OCR preview rows

function $(id){ return document.getElementById(id); }
function fmt(n){ return `$${Number(n).toFixed(2)}`; }
function money(n){ return `$${Number(n).toFixed(2)}`; }

function pct(value, total){
  if (!total) return "0.0%";
  return ((value / total) * 100).toFixed(1) + "%";
}

// ===== TOTALS HELPERS =====
function sumByType(txs, type){
  return txs.filter(t => t.type === type)
            .reduce((s,t)=>s+Number(t.amount),0);
}

function setMoney(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = money(value);
}

function setText(id, value){
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
}

function setNetStyle(el, net){
  if (!el) return;
  el.style.fontWeight = "700";
  el.style.color = net > 0 ? "#0a7a2f"
                : net < 0 ? "#b00020"
                : "#444";
}

// Stable color from label
function colorForLabel(label){
  let h = 0;
  const s = String(label);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 45%)`;
}

async function initDB(){
  db = await openDB('budget-db', 1, {
    upgrade(db){
      const store = db.createObjectStore('tx', { keyPath: 'id', autoIncrement: true });
      store.createIndex('byDate', 'date');
    }
  });
}

function fillCategories(){
  const sel = $('category');
  if (!sel) return;
  sel.innerHTML = "";
  CATEGORIES.forEach(c => {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    sel.appendChild(o);
  });
  sel.value = "Groceries";
}

function todayISO(){
  const d = new Date();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${d.getFullYear()}-${m}-${day}`;
}

async function addTx(tx){
  await db.add('tx', tx);
  await refreshUI();
}

async function getAllTx(){
  return await db.getAll('tx');
}

function filterTxByMonth(txs){
  const showAll = document.getElementById('showAll')?.checked;
  const month = document.getElementById('monthFilter')?.value; // YYYY-MM
  if (showAll || !month) return txs;
  return txs.filter(t => (t.date || "").startsWith(month));
}

// ---------- Grouping ----------
function groupSpendByCategory(txs){
  const map = new Map();
  txs.filter(t => t.type === 'expense').forEach(t => {
    map.set(t.category, (map.get(t.category)||0) + Number(t.amount));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}

function groupByMerchant(txs, type){
  const map = new Map();
  txs.filter(t => t.type === type).forEach(t => {
    const key = (t.merchant && t.merchant.trim()) ? t.merchant.trim() : 'Unknown';
    map.set(key, (map.get(key)||0) + Number(t.amount));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}

// ---------- Legends ----------
function renderLegend(divId, labels, values){
  const div = document.getElementById(divId);
  if (!div) return;

  const total = values.reduce((a,b)=>a+b,0);
  const rows = labels.map((lab, i) => {
    const v = values[i];
    const c = colorForLabel(lab);
    return `
      <tr>
        <td><span class="dot" style="background:${c}"></span>${lab}</td>
        <td style="text-align:right;">${money(v)}</td>
        <td style="text-align:right; color:#666;">${pct(v,total)}</td>
      </tr>`;
  }).join('');

  div.innerHTML = `
    <table class="legendTable">
      <thead>
        <tr>
          <td><b>Label</b></td>
          <td style="text-align:right;"><b>$</b></td>
          <td style="text-align:right;"><b>%</b></td>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------- Charts ----------
function createSmallPie(chartRef, canvasId, labels, values){
  const canvas = document.getElementById(canvasId);
  if (!canvas) return chartRef;
  if (chartRef) chartRef.destroy();

  const bg = labels.map(colorForLabel);
  const total = values.reduce((a,b)=>a+b,0);

  return new Chart(canvas, {
    type: 'pie',
    data: { labels, datasets: [{ data: values, backgroundColor: bg }] },
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          callbacks: {
            label: (item) => {
              const v = item.raw ?? 0;
              return `${item.label}: ${money(v)} (${pct(v,total)})`;
            }
          }
        },
        datalabels: {
          color: "#fff",
          font: { weight: "700", size: 10 },
          formatter: (value) => pct(value, total),
        }
      }
    }
  });
}

// ===== TOTALS RENDER =====
function renderTotals(txs){
  const deposits = sumByType(txs, 'income');
  const expenses = sumByType(txs, 'expense');
  const net = deposits - expenses;

  setMoney('totalDeposits', deposits);
  setMoney('totalExpenses', expenses);

  const netEl = document.getElementById('totalNet');
  if (netEl) {
    netEl.textContent =
      (net >= 0 ? "+" : "-") + money(Math.abs(net));
    setNetStyle(netEl, net);
  }

  const rate = deposits > 0
    ? (expenses / deposits * 100)
    : 0;

  setText('spendRate', rate.toFixed(1) + "%");
}

function renderExpensesPie(txs){
  const data = groupSpendByCategory(txs);
  const labels = data.map(x=>x[0]);
  const values = data.map(x=>x[1]);
  pieExpensesChart = createSmallPie(pieExpensesChart, 'pieExpenses', labels, values);
  renderLegend('legendExpenses', labels, values);
}

function renderDepositsPie(txs){
  const data = groupByMerchant(txs, 'income').slice(0, 12);
  const labels = data.map(x=>x[0]);
  const values = data.map(x=>x[1]);
  pieDepositsChart = createSmallPie(pieDepositsChart, 'pieDeposits', labels, values);
  renderLegend('legendDeposits', labels, values);
}

function renderRatioPie(txs){
  const totalExpenses = txs.filter(t => t.type === 'expense').reduce((s,t)=>s+Number(t.amount),0);
  const totalDeposits = txs.filter(t => t.type === 'income').reduce((s,t)=>s+Number(t.amount),0);
  const labels = ['Expenses', 'Deposits'];
  const values = [totalExpenses, totalDeposits];
  pieRatioChart = createSmallPie(pieRatioChart, 'pieRatio', labels, values);
  renderLegend('legendRatio', labels, values);
}

// ---------- Transactions table (edit category + delete) ----------
function renderTxList(txs){
  txs.sort((a,b)=> (b.date||'').localeCompare(a.date||''));

  const html = `
    <table>
      <thead>
        <tr>
          <th>Date</th><th>Merchant</th><th>Category</th><th>Type</th><th>Amount</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${txs.slice(0,60).map(t=>`
          <tr>
            <td>${t.date}</td>
            <td>${t.merchant || ''}</td>
            <td>
              <select class="catSel" data-id="${t.id}">
                ${CATEGORIES.map(c => `<option value="${c}" ${c===t.category?'selected':''}>${c}</option>`).join('')}
              </select>
            </td>
            <td>${t.type}</td>
            <td>${t.type==='expense' ? '-' : '+'}${fmt(t.amount)}</td>
            <td style="white-space:nowrap;">
              <button class="saveBtn" data-id="${t.id}">Save</button>
              <button class="delBtn" data-id="${t.id}">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  $('txList').innerHTML = html;

  // Save category edits
  document.querySelectorAll('.saveBtn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      const sel = document.querySelector(`.catSel[data-id="${id}"]`);
      if (!sel) return;

      const tx = await db.get('tx', id);
      if (!tx) return;

      tx.category = sel.value;
      await db.put('tx', tx);
      await refreshUI();
    };
  });

  // Delete
  document.querySelectorAll('.delBtn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      if (!Number.isFinite(id)) return;
      if (!confirm("Delete this transaction?")) return;
      await db.delete('tx', id);
      await refreshUI();
    };
  });
}

// ---------- UI refresh ----------
async function refreshUI(){
  const all = await getAllTx();
  const txs = filterTxByMonth(all);
  
  renderTotals(txs);

  $('status').textContent = `Saved transactions (on this phone): ${all.length} | Showing: ${txs.length}`;

  renderExpensesPie(txs);
  renderDepositsPie(txs);
  renderRatioPie(txs);

  renderTxList(txs);
}

// ---------- OCR + parsing ----------
function parseAmount(s){
  let t = s.trim().replace(/\$/g,'').replace(/,/g,'');
  if (t.startsWith('(') && t.endsWith(')')) t = '-' + t.slice(1,-1);
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function normalizeMerchant(s){
  return s.replace(/\s+/g,' ').trim().slice(0,80);
}

function autoCategory(merchant){
  const m = merchant.toLowerCase();
  const rules = [
    [/rent|landlord|property/i, "Rent/Mortgage"],
    [/pg&e|pge|electric|water|trash|xfinity|comcast|verizon|att/i, "Utilities"],
    [/safeway|trader joe|whole foods|costco|walmart|kroger/i, "Groceries"],
    [/doordash|ubereats|grubhub|restaurant|cafe|coffee|starbucks/i, "Dining"],
    [/chevron|shell|arco|exxon|mobil|76|gas/i, "Gas/Transport"],
    [/uber|lyft|parking|toll|fastrak|bart|caltrain|muni|vta/i, "Gas/Transport"],
    [/netflix|spotify|hulu|disney\+|apple\.com\/bill|prime/i, "Subscriptions"],
    [/amazon|best buy|apple store|nike|adidas/i, "Shopping"],
    [/movie|cinema|theater|ticketmaster|concert|arcade/i, "Entertainment"],
    [/airbnb|hotel|hilton|marriott|delta|united|southwest|expedia/i, "Travel"],
    [/loan|credit card|payment|discover|amex|capital one/i, "Debt"],
    [/vanguard|fidelity|robinhood|schwab|401k|ira/i, "Savings/Investing"],
    [/transfer|zelle|venmo|paypal|cash app/i, "Transfer"]
  ];
  for (const [re, cat] of rules) if (re.test(m)) return cat;
  return "Other";
}

// "MM/DD Merchant -12.34" or "MM/DD/YYYY Merchant 12.34"
function parseOcrText(text){
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const out = [];
  const year = new Date().getFullYear();
  const re = /^(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s+(.*?)\s+([-(]?\$?\d[\d,]*\.\d{2}\)?)$/;

  for (const line of lines){
    const m = line.match(re);
    if (!m) continue;

    const dateStr = m[1];
    const merch = normalizeMerchant(m[2]);
    const amtRaw = parseAmount(m[3]);
    if (amtRaw === null) continue;

    const parts = dateStr.split('/');
    let mm = parts[0].padStart(2,'0');
    let dd = parts[1].padStart(2,'0');
    let yyyy = (parts[2] ? parts[2] : String(year));
    if (yyyy.length === 2) yyyy = '20' + yyyy;

    const iso = `${yyyy}-${mm}-${dd}`;
    const type = amtRaw < 0 ? 'expense' : 'income';
    const amt = Math.abs(amtRaw);
    const cat = (type === 'income') ? 'Income' : autoCategory(merch);

    out.push({ date: iso, merchant: merch, amount: amt, type, category: cat });
  }

  // de-dupe within batch
  const seen = new Set();
  return out.filter(r=>{
    const k = `${r.date}|${r.type}|${r.amount.toFixed(2)}|${r.merchant.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function renderPreview(rows){
  if (!rows.length){
    $('preview').innerHTML = `<p>No rows detected. Use a clearer/zoomed screenshot.</p>`;
    return;
  }
  $('preview').innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Type</th><th>Amount</th></tr></thead>
      <tbody>
        ${rows.map(r=>`
          <tr>
            <td>${r.date}</td>
            <td>${r.merchant}</td>
            <td>${r.category}</td>
            <td>${r.type}</td>
            <td>${r.type==='expense' ? '-' : '+'}${fmt(r.amount)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ---------- Main ----------
(async function main(){
  await initDB();

  // Enable % labels on pies
  if (window.ChartDataLabels) Chart.register(ChartDataLabels);

  fillCategories();
  $('date').value = todayISO();
  $('status').textContent = 'Ready.';

  // Month filter defaults + listeners
  const now = new Date();
  const mm = String(now.getMonth()+1).padStart(2,'0');
  const monthEl = document.getElementById('monthFilter');
  if (monthEl) monthEl.value = `${now.getFullYear()}-${mm}`;

  document.getElementById('monthFilter')?.addEventListener('change', refreshUI);
  document.getElementById('showAll')?.addEventListener('change', refreshUI);

  await refreshUI();

  $('addBtn').onclick = async () => {
    const d = $('date').value;
    const type = $('type').value;
    const amount = Number($('amount').value);
    const merchant = $('merchant').value || '';
    const category = (type === 'income') ? 'Income' : $('category').value;

    if (!d || !(amount > 0)) return alert('Enter a valid date and amount.');
    await addTx({ date: d, type, amount, merchant, category });
    $('amount').value = '';
    $('merchant').value = '';
  };

  $('ocrBtn').onclick = async () => {
    const file = $('imgInput').files?.[0];
    if (!file) return alert('Pick an image first.');

    $('ocrStatus').textContent = 'Running OCR… (this can take a bit)';
    $('importBtn').disabled = true;

    const result = await Tesseract.recognize(file, 'eng');
    const text = result.data.text || '';

    parsedRows = parseOcrText(text);
    renderPreview(parsedRows);

    $('ocrStatus').textContent = `OCR done. Detected rows: ${parsedRows.length}`;
    $('importBtn').disabled = parsedRows.length === 0;
  };

  $('importBtn').onclick = async () => {
    let added = 0;

    // simple dedupe across DB
    const existing = await getAllTx();
    const set = new Set(existing.map(t =>
      `${t.date}|${t.type}|${Number(t.amount).toFixed(2)}|${(t.merchant||'').toLowerCase()}`
    ));

    for (const r of parsedRows){
      const k = `${r.date}|${r.type}|${r.amount.toFixed(2)}|${r.merchant.toLowerCase()}`;
      if (set.has(k)) continue;
      await db.add('tx', r);
      set.add(k);
      added++;
    }

    alert(`Imported ${added} new transactions (duplicates skipped).`);
    parsedRows = [];
    $('preview').innerHTML = '';
    $('importBtn').disabled = true;

    await refreshUI();
  };
})();
