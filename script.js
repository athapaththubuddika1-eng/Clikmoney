// Initialize Telegram SDK
const tg = window.Telegram.WebApp;
tg.expand();

let user = {
  balance: parseFloat(localStorage.getItem('balance')) || 0,
  referrals: parseInt(localStorage.getItem('referrals')) || 0,
};

// Tab Navigation
const content = document.getElementById('content');
const tabs = document.querySelectorAll('.tabs button');
tabs.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function switchTab(tab) {
  tabs.forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  if (tab === 'home') loadHome();
  if (tab === 'ads') loadAds();
  if (tab === 'ref') loadRef();
  if (tab === 'withdraw') loadWithdraw();
}

// 🏠 Home Tab
function loadHome() {
  content.innerHTML = `
    <div class="card">
      <h2>Total Balance: $${user.balance.toFixed(4)}</h2>
      <h3>Referrals: ${user.referrals}</h3>
      <button class="btn" onclick="switchTab('withdraw')">💸 Withdraw</button>
    </div>
  `;
}

// 🎬 Watch Ads
function loadAds() {
  content.innerHTML = `
    <div class="card">
      <h3>Watch Ads to Earn $0.0001 Each</h3>
      <button class="btn" onclick="watchAd()">▶️ Watch Ad</button>
    </div>
  `;
}

function watchAd() {
  window.open('https://www.effectivegatecpm.com/dnm2jrcaj?key=c73c264e4447410ce55eb32960238eaa', '_blank');
  setTimeout(() => {
    user.balance += 0.0001;
    saveData();
    alert('✅ +$0.0001 added to your balance!');
    loadHome();
  }, 5000);
}

// 👥 Referrals
function loadRef() {
  const botUsername = 'click_money01bot'; // updated bot username
  const userId = tg.initDataUnsafe?.user?.id || Math.floor(Math.random() * 1000000);
  const refLink = `https://t.me/${botUsername}?start=${userId}`;

  content.innerHTML = `
    <div class="card">
      <h3>Your Referral Link</h3>
      <p><small>${refLink}</small></p>
      <button class="btn" onclick="copyRef('${refLink}')">📋 Copy Link</button>
    </div>
  `;
}

function copyRef(link) {
  navigator.clipboard.writeText(link);
  alert('✅ Referral link copied!');
}

// 💸 Withdraw
function loadWithdraw() {
  content.innerHTML = `
    <div class="card">
      <h3>Withdraw (Min $0.10)</h3>
      <input type="text" id="wallet" placeholder="Binance ID or USDT Polygon Address" style="width:90%;padding:10px;border-radius:8px;">
      <button class="btn" onclick="withdraw()">💵 Request Withdraw</button>
    </div>
  `;
}

function withdraw() {
  const wallet = document.getElementById('wallet').value;
  if (!wallet) return alert('⚠️ Enter your wallet address!');
  if (user.balance < 0.1) return alert('❌ Minimum withdraw is $0.10');

  user.balance -= 0.1;
  saveData();

  alert('✅ Withdraw request sent!');
  loadHome();

  // Later you can send this request to your Telegram channel via backend
  // sendWithdrawToAdmin(wallet, 0.1);
}

function saveData() {
  localStorage.setItem('balance', user.balance);
  localStorage.setItem('referrals', user.referrals);
}

// Default tab
loadHome();
