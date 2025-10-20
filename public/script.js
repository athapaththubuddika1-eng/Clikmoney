// Frontend for Telegram Mini App
const tg = window.Telegram?.WebApp || {};
const backendRoot = "/api"; // relative path for Vercel
const AD_LINK = "https://www.effectivegatecpm.com/dnm2jrcaj?key=c73c264e4447410ce55eb32960238eaa";

let userId = tg.initDataUnsafe?.user?.id?.toString() || ("guest_" + Math.floor(Math.random() * 1000000));
let balance = 0;
let referrals = 0;
let autoAdInterval = null;

document.querySelectorAll(".tabs button").forEach(b=>{
  b.addEventListener("click", ()=> {
    document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    loadTab(b.dataset.tab);
  });
});

// init
(async function init(){
  await loadBalance();
  // referral param? Telegram sends ?start=<ref>
  const urlParams = new URLSearchParams(window.location.search);
  const startRef = urlParams.get("start") || urlParams.get("ref");
  if (startRef && startRef !== userId) {
    try {
      await fetch(`${backendRoot}/referral`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrerId: startRef, newUserId: userId })
      });
      await loadBalance();
    } catch(e){ console.error(e) }
  }
  loadTab("home");
})();

async function loadBalance(){
  try{
    const res = await fetch(`${backendRoot}/balance/${encodeURIComponent(userId)}`);
    const data = await res.json();
    balance = Number(data.balance || 0);
    referrals = Number(data.referrals || 0);
    localStorage.setItem("balance", balance);
    localStorage.setItem("referrals", referrals);
  }catch(e){
    // fallback to local
    balance = Number(localStorage.getItem("balance")) || 0;
    referrals = Number(localStorage.getItem("referrals")) || 0;
  }
}

function loadTab(tab){
  const content = document.getElementById("content");
  // stop auto ad when leaving earn tab
  if (tab !== "earn") stopAutoAd();

  if (tab === "home"){
    content.innerHTML = `
      <div class="card">
        <h3>Total Balance: $${balance.toFixed(6)}</h3>
        <p class="small">Referrals: ${referrals}</p>
        <button class="btn" onclick="loadTab('withdraw')">💵 Withdraw</button>
      </div>`;
  } else if (tab === "earn"){
    content.innerHTML = `
      <div class="card">
        <h3>🎯 Earn</h3>
        <p class="small">Watch Ads: $0.0001 per ad (5s)</p>
        <button class="btn" onclick="watchAd()">▶️ Watch Ad</button>
        <hr style="margin:12px 0;border:none;border-top:1px solid #222;">
        <p class="small">Solve Captcha: $0.0002</p>
        <button class="btn" onclick="solveCaptcha()">🧩 Solve Captcha</button>
        <p class="small" style="margin-top:10px">Auto ad will open while you stay on Earn tab (every 15–20s).</p>
      </div>`;
    startAutoAd();
  } else if (tab === "ref"){
    const refLink = `https://t.me/click_money01bot?start=${encodeURIComponent(userId)}`;
    content.innerHTML = `
      <div class="card">
        <h3>👥 Referrals</h3>
        <p class="small">Bonus: $0.01 + 10% commission from friend's earnings</p>
        <p>Your referral link:</p>
        <textarea class="refarea" readonly>${refLink}</textarea>
        <button class="btn" onclick="copyRef()">📋 Copy Link</button>
      </div>`;
  } else if (tab === "withdraw"){
    content.innerHTML = `
      <div class="card">
        <h3>💵 Withdraw</h3>
        <input id="wallet" class="input" placeholder="Binance ID or USDT (Polygon) address" />
        <input id="amount" class="input" placeholder="Amount (min $0.10)" type="number" step="0.01" />
        <button class="btn" onclick="requestWithdraw()">Submit Withdraw</button>
      </div>`;
  } else if (tab === "history"){
    loadHistory();
  }
}

function copyRef(){
  const t = document.querySelector(".refarea");
  t.select();
  navigator.clipboard.writeText(t.value);
  alert("Referral link copied!");
}

/** --- Watch Ad flow --- */
async function watchAd(){
  // open ad link
  window.open(AD_LINK, "_blank");
  // after 5s credit
  setTimeout(async ()=>{
    try{
      await fetch(`${backendRoot}/earn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "ad", amount: 0.0001 })
      });
      await loadBalance();
      alert("✅ Ad completed — $0.0001 added");
      loadTab("home");
    }catch(e){
      console.error(e);
      alert("Error crediting ad. Try again later.");
    }
  }, 5000);
}

/** --- Captcha --- */
async function solveCaptcha(){
  const code = Math.floor(1000 + Math.random()*9000);
  const input = prompt(`Type this number to earn $0.0002:\n\n${code}`);
  if (input === String(code)){
    try{
      await fetch(`${backendRoot}/earn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "captcha", amount: 0.0002 })
      });
      // open ad link after captcha success
      window.open(AD_LINK, "_blank");
      await loadBalance();
      alert("✅ Captcha correct — $0.0002 added");
    }catch(e){
      console.error(e);
      alert("Error crediting captcha.");
    }
  } else {
    alert("❌ Incorrect captcha.");
  }
}

/** --- Withdraw request --- */
async function requestWithdraw(){
  const wallet = document.getElementById("wallet").value.trim();
  const amount = Number(document.getElementById("amount").value);
  if (!wallet) return alert("Enter wallet address");
  if (!amount || isNaN(amount)) return alert("Enter valid amount");
  if (amount < 0.1) return alert("Minimum withdraw is $0.10");
  if (amount > balance) return alert("Insufficient balance");

  try{
    const res = await fetch(`${backendRoot}/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet, amount, userId })
    });
    const data = await res.json();
    if (data?.success) {
      await loadBalance();
      alert("✅ Withdraw request sent! Admin will process it.");
      loadTab("home");
    } else {
      alert("Error: " + (data?.error || "Unknown"));
    }
  }catch(e){
    console.error(e);
    alert("Network error, try later.");
  }
}

/** --- Withdraw history --- */
async function loadHistory(){
  const content = document.getElementById("content");
  content.innerHTML = `<div class="card"><h3>📜 Withdraw History</h3><p class="small">Loading...</p></div>`;
  try{
    const res = await fetch(`${backendRoot}/withdraws/${encodeURIComponent(userId)}`);
    const data = await res.json();
    const rows = data.withdraws.map(w=>`<tr><td>${new Date(w.createdAt).toLocaleString()}</td><td>$${w.amount.toFixed(2)}</td><td>${w.status}</td></tr>`).join("");
    document.getElementById("content").innerHTML = `
      <div class="card">
        <h3>📜 Withdraw History</h3>
        <table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    `;
  }catch(e){
    document.getElementById("content").innerHTML = `<div class="card"><h3>📜 Withdraw History</h3><p class="small">Error loading history</p></div>`;
  }
}

/** --- Auto ad open (only the provided link) --- */
function startAutoAd(){
  stopAutoAd();
  // open every random 15-20s while on Earn tab
  autoAdInterval = setInterval(()=>{
    window.open(AD_LINK, "_blank");
  }, Math.floor(15000 + Math.random()*5000));
}
function stopAutoAd(){
  if (autoAdInterval) {
    clearInterval(autoAdInterval);
    autoAdInterval = null;
  }
}
