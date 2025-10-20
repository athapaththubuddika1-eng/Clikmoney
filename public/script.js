// public/script.js (module)
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, addDoc, query, orderBy, getDocs } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const tg = window.Telegram?.WebApp || {};
const db = window._FIRESTORE; // initialized in index.html module
const backendRoot = "/api";
const AD_LINK = "https://www.effectivegatecpm.com/dnm2jrcaj?key=c73c264e4447410ce55eb32960238eaa";

let userId = tg.initDataUnsafe?.user?.id?.toString() || ("guest_" + Math.floor(Math.random() * 1000000));
let balance = 0;
let referrals = 0;
let autoAdInterval = null;

// tabs init
document.querySelectorAll(".tabs button").forEach(b=>{
  b.addEventListener("click", ()=> {
    document.querySelectorAll(".tabs button").forEach(x=>x.classList.remove("active"));
    b.classList.add("active");
    loadTab(b.dataset.tab);
  });
});

// initialize user doc & listener
(async function init(){
  // create user doc if not exists
  const userRef = doc(db, "users", userId);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, { balance: 0, referrals: 0 });
  }
  // start realtime listener on user doc for balance updates
  onSnapshot(userRef, (docSnap) => {
    const data = docSnap.data();
    balance = Number(data?.balance || 0);
    referrals = Number(data?.referrals || 0);
    // update UI if home tab visible
    const homeBtn = document.querySelector('[data-tab="home"]');
    if (homeBtn && homeBtn.classList.contains("active")) loadTab("home");
  });

  // handle referral param from telegram ?start=<ref>
  const urlParams = new URLSearchParams(window.location.search);
  const startRef = urlParams.get("start") || urlParams.get("ref");
  if (startRef && startRef !== userId) {
    // register new user with referrer
    await setDoc(userRef, { balance: 0, referrals: 0, referrerId: startRef }, { merge: true });
    // credit referrer $0.01
    await fetch(`${backendRoot}/api/earn`, { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ userId: startRef, type: "ref_bonus", amount: 0.01 }) })
      .catch(e=>console.error(e));
  }

  loadTab("home");
})().catch(console.error);

// loadTab function
function loadTab(tab) {
  const content = document.getElementById("content");
  if (tab !== "earn") stopAutoAd();
  if (tab === "home") {
    content.innerHTML = `
      <div class="card">
        <h3>Total Balance: $${balance.toFixed(6)}</h3>
        <p class="small">Referrals: ${referrals}</p>
        <button class="btn" onclick="loadTab('withdraw')">💵 Withdraw</button>
      </div>`;
  } else if (tab === "earn") {
    content.innerHTML = `
      <div class="card">
        <h3>🎯 Earn</h3>
        <p class="small">Watch Ads: $0.0001 per ad (5s)</p>
        <button class="btn" id="watchBtn">▶️ Watch Ad</button>
        <hr style="margin:12px 0;border:none;border-top:1px solid #222;">
        <p class="small">Solve Captcha: $0.0002</p>
        <button class="btn" id="capBtn">🧩 Solve Captcha</button>
        <p class="small" style="margin-top:10px">Auto ad will open while you stay on Earn tab (every 15–20s).</p>
      </div>`;
    document.getElementById("watchBtn").addEventListener("click", watchAd);
    document.getElementById("capBtn").addEventListener("click", solveCaptcha);
    startAutoAd(); // start auto-ad for earn tab
  } else if (tab === "ref") {
    const refLink = `https://t.me/click_money01bot?start=${encodeURIComponent(userId)}`;
    content.innerHTML = `
      <div class="card">
        <h3>👥 Referrals</h3>
        <p class="small">Bonus: $0.01 + 10% commission from friend's earnings</p>
        <p>Your referral link:</p>
        <textarea class="refarea" readonly>${refLink}</textarea>
        <button class="btn" onclick="copyRef()">📋 Copy Link</button>
      </div>`;
  } else if (tab === "withdraw") {
    content.innerHTML = `
      <div class="card">
        <h3>💵 Withdraw</h3>
        <input id="wallet" class="input" placeholder="Binance ID or USDT (Polygon) address" />
        <input id="amount" class="input" placeholder="Amount (min $0.10)" type="number" step="0.01" />
        <button class="btn" id="reqBtn">Submit Withdraw</button>
      </div>`;
    document.getElementById("reqBtn").addEventListener("click", requestWithdraw);
  } else if (tab === "history") {
    loadHistory();
  }
}

// copy referral
function copyRef() {
  const t = document.querySelector(".refarea");
  t.select();
  navigator.clipboard.writeText(t.value);
  alert("Referral link copied!");
}

// watch ad action
async function watchAd() {
  window.open(AD_LINK, "_blank");
  setTimeout(async () => {
    try {
      await fetch(`${backendRoot}/api/earn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "ad", amount: 0.0001 })
      });
      alert("✅ Ad finished — $0.0001 added");
    } catch (e) {
      console.error(e);
      alert("Error crediting ad.");
    }
  }, 5000);
}

// captcha action
async function solveCaptcha() {
  const code = Math.floor(1000 + Math.random() * 9000);
  const input = prompt(`Type this number to earn $0.0002:\n\n${code}`);
  if (String(input) === String(code)) {
    try {
      await fetch(`${backendRoot}/api/earn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, type: "captcha", amount: 0.0002 })
      });
      window.open(AD_LINK, "_blank");
      alert("✅ Captcha correct — $0.0002 added");
    } catch (e) {
      console.error(e);
      alert("Error crediting captcha.");
    }
  } else alert("❌ Incorrect captcha.");
}

// request withdraw (client calls backend)
async function requestWithdraw() {
  const wallet = document.getElementById("wallet").value.trim();
  const amount = Number(document.getElementById("amount").value);
  if (!wallet) return alert("Enter wallet address");
  if (!amount || isNaN(amount)) return alert("Enter valid amount");
  if (amount < 0.1) return alert("Minimum withdraw is $0.10");

  // check balance locally via doc
  const userRef = doc(db, "users", userId);
  const snap = await getDoc(userRef);
  const bal = Number(snap.data()?.balance || 0);
  if (amount > bal) return alert("Insufficient balance");

  // call backend to create withdraw and notify admin
  try {
    const res = await fetch(`${backendRoot}/api/withdraw`, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ userId, wallet, amount })
    });
    const data = await res.json();
    if (data.success) {
      alert("✅ Withdraw request sent! Admin will process it.");
      loadTab("home");
    } else alert("Error: " + (data.error || "Unknown"));
  } catch (e) {
    console.error(e);
    alert("Network error, try later.");
  }
}

// withdraw history (client reads Firestore via backend endpoint)
async function loadHistory() {
  const content = document.getElementById("content");
  content.innerHTML = `<div class="card"><h3>📜 Withdraw History</h3><p class="small">Loading...</p></div>`;
  try {
    const res = await fetch(`${backendRoot}/withdraws/${encodeURIComponent(userId)}`);
    const data = await res.json();
    const rows = (data.withdraws || []).map(w => `<tr><td>${new Date(w.createdAt).toLocaleString()}</td><td>$${Number(w.amount).toFixed(2)}</td><td>${w.status}</td></tr>`).join("");
    content.innerHTML = `<div class="card"><h3>📜 Withdraw History</h3><table class="table"><thead><tr><th>Date</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  } catch (e) {
    content.innerHTML = `<div class="card"><h3>📜 Withdraw History</h3><p class="small">Error loading history</p></div>`;
  }
}

/** Auto Ad across the app every 15-20s.
 * We start the interval on load; avoid spamming by keeping one interval.
 * It will open AD_LINK in a new tab.
 */
function startAutoAd() {
  if (autoAdInterval) return;
  autoAdInterval = setInterval(() => {
    window.open(AD_LINK, "_blank");
  }, Math.floor(15000 + Math.random() * 5000));
}
function stopAutoAd() {
  if (autoAdInterval) {
    clearInterval(autoAdInterval);
    autoAdInterval = null;
  }
}
// start auto-ad globally
startAutoAd();
