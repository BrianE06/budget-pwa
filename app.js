// Register service worker (offline)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');

const CATEGORIES = [
  "Rent/Mortgage","Utilities","Groceries","Dining","Gas/Transport","Car",
  "Insurance","Medical","Subscriptions","Shopping","Entertainment","Travel",
  "Debt","Savings/Investing","Income","Transfer","Other"
];

const { openDB } = idb;

let db, pieExpensesChart, pieDepositsChart, pieRatioChart;
let parsedRows = []; // OCR preview rows

function $(id){ return document.getElementById(id); }
function fmt(n){ return `$${Number(n).toFixed(2)}`; }
function money(n){ return `$${Number(n).toFixed(2)}`; }

function pct(value, total){
  if (!total) return "0.0%";
  return ((value / total) * 100).toFixed(1) + "%";
}

// stable color from a label (category/merchant)
function colorForLabel(label){
  let h = 0;
  const s = String(label);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 45%)`;
}

function filterTxByMonth(txs){
  const showAll = document.getElementById('showAll')?.checked;
  const month = document.getElementById('monthFilter')?.value; // YYYY-MM
  if (showAll || !month) return txs;
  return txs.filter(t => (t.date || "").startsWith(month));
}

function renderLegend(divId, labels, values){
  const div = document.getElementById(divId);
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

function groupSpendByCategory(txs){
  const map = new Map();
  txs.filter(t=>t.type==='expense').forEach(t=>{
    map.set(t.category, (map.get(t.category)||0) + Number(t.amount));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}

function groupByMerchant(txs, type){
  const map = new Map();
  txs.filter(t => t.type === type).forEach(t => {
    const key = (t.merchant && t.merchant.trim()) ? t.merchant.trim() : 'Unknown';
    map.set(key, (map.get(key) || 0) + Number(t.amount));
  });
  return [...map.entries()].sort((a,b)=>b[1]-a[1]);
}

function renderExpensesPie(txs){
  const data = groupSpendByCategory(txs);
  const labels = data.map(x=>x[0]);
  const values = data.map(x=>x[1]);

  const ctx = document.getElementById('pieExpenses');
  if (pieExpensesChart) pieExpensesChart.destroy();

  pieExpensesChart = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
}

function renderDepositsPie(txs){
  // Income grouped by merchant. If you prefer category, I can swap it.
  const data = groupByMerchant(txs, 'income').slice(0, 15); // top 15 to keep readable
  const labels = data.map(x=>x[0]);
  const values = data.map(x=>x[1]);

  const ctx = document.getElementById('pieDeposits');
  if (pieDepositsChart) pieDepositsChart.destroy();

  pieDepositsChart = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: values }] },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
}

function renderRatioPie(txs){
  const totalExpenses = txs
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const totalDeposits = txs
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const ctx = document.getElementById('pieRatio');
  if (pieRatioChart) pieRatioChart.destroy();

  pieRatioChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Expenses', 'Deposits'],
      datasets: [{ data: [totalExpenses, totalDeposits] }]
    },
    options: { plugins: { legend: { position: 'bottom' } } }
  });
}

function renderTxList(txs){
  txs.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  const html = `
    <table>
      <thead>
      <tr>
      <th>Date</th><th>Merchant</th><th>Category</th><th>Type</th><th>Amount</th>
      </tr>
      </thead>
      <tbody>
        ${txs.slice(0,50).map(t=>`
          <tr>
            <td>${t.date}</td>
            <td>${t.merchant || ''}</td>
            <td>${t.category}</td>
            <td>${t.type}</td>
            <td>${t.type==='expense' ? '-' : '+'}${fmt(t.amount)}</td>
          <td>
           <button class="delBtn" data-id="${t.id}">Delete</button>
           </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
  $('txList').innerHTML = html;
  // wire up delete buttons
  document.querySelectorAll('.delBtn').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.id);
      if (!Number.isFinite(id)) return;

      const ok = confirm("Delete this transaction?");
      if (!ok) return;

      await db.delete('tx', id);
      await refreshUI();
    };
  });
}

async function refreshUI(){
  const txs = await getAllTx();
  $('status').textContent = `Saved transactions: ${txs.length} (stored only on this phone)`;
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

// Basic statement-like line parser:
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

    // normalize date to YYYY-MM-DD
    const parts = dateStr.split('/');
    let mm = parts[0].padStart(2,'0');
    let dd = parts[1].padStart(2,'0');
    let yyyy = (parts[2] ? parts[2] : String(year));
    if (yyyy.length === 2) yyyy = '20' + yyyy;

    const iso = `${yyyy}-${mm}-${dd}`;

    const type = amtRaw < 0 ? 'expense' : 'income';
    const amt = Math.abs(amtRaw);

    // simple auto-category
    const cat = (type==='income') ? 'Income' : autoCategory(merch);

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

// UI wiring
(async function main(){
  await initDB();
  fillCategories();
  $('date').value = todayISO();
  $('status').textContent = 'Ready.';
  await refreshUI();

  $('addBtn').onclick = async () => {
    const d = $('date').value;
    const type = $('type').value;
    const amount = Number($('amount').value);
    const merchant = $('merchant').value || '';
    const category = type === 'income' ? 'Income' : $('category').value;

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
    // very simple dedupe: check existing rows before insert
    const existing = await getAllTx();
    const set = new Set(existing.map(t => `${t.date}|${t.type}|${Number(t.amount).toFixed(2)}|${(t.merchant||'').toLowerCase()}`));

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
