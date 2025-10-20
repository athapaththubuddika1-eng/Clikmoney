// api/index.js
import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
app.use(cors());
app.use(bodyParser.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // -5419054691
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID; // clickmoney-ff9c1

if (!BOT_TOKEN || !ADMIN_CHAT_ID || !FIREBASE_PROJECT_ID) {
  console.error("Missing env vars BOT_TOKEN, ADMIN_CHAT_ID, FIREBASE_PROJECT_ID");
}

const TELEGRAM_API = (method) => `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Helper to send telegram message (with optional reply_markup)
async function sendTelegramMessage(chat_id, text, reply_markup) {
  try {
    const body = { chat_id, text, parse_mode: "Markdown" };
    if (reply_markup) body.reply_markup = reply_markup;
    const res = await fetch(TELEGRAM_API("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  } catch (e) {
    console.error("sendTelegramMessage error", e);
  }
}

// ========== Firestore REST helpers (simple) ==========
// Documents path examples:
// users/{userId} => `${FIRESTORE_BASE}/users/{userId}`
// withdraws/{withdrawId} => `${FIRESTORE_BASE}/withdraws/{withdrawId}`

// Helper to create/update a document (PATCH with mask to create & merge)
async function firestorePatch(docPath, dataObj) {
  // convert plain object to Firestore fields format
  // supports only strings, numbers, booleans, maps, arrays - minimal mapping
  function toFields(obj) {
    const fields = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") fields[k] = { stringValue: v };
      else if (typeof v === "number") fields[k] = { doubleValue: v };
      else if (typeof v === "boolean") fields[k] = { booleanValue: v };
      else if (v === null) fields[k] = { nullValue: null };
      else if (Array.isArray(v)) {
        fields[k] = { arrayValue: { values: v.map(x => (typeof x === "string" ? { stringValue: x } : typeof x === "number" ? { doubleValue: x } : { stringValue: String(x) })) } } };
      } else if (typeof v === "object") {
        fields[k] = { mapValue: { fields: toFields(v) } };
      } else {
        fields[k] = { stringValue: String(v) };
      }
    }
    return fields;
  }

  const url = `${FIRESTORE_BASE}/${docPath}?currentDocument.exists=true`;
  const body = { fields: toFields(dataObj) };
  try {
    // try PATCH (update existing)
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 200 && res.status < 300) return res.json();
    // if not exist, use create (POST)
  } catch (e) { /* ignore */ }

  // Create (POST) fallback
  const parent = docPath.split("/").slice(0, -1).join("/");
  const res2 = await fetch(`${FIRESTORE_BASE}/${parent}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res2.json();
}

// Simpler: patchOrCreate doc using "documents/{path}" with name
async function firestoreCreateDoc(docPath, dataObj) {
  // docPath like "users/<id>" or "withdraws/<id>"
  const url = `${FIRESTORE_BASE}/${docPath}`;
  const body = { fields: {} };
  function toFields(obj) {
    const fields = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") fields[k] = { stringValue: v };
      else if (typeof v === "number") fields[k] = { doubleValue: v };
      else if (typeof v === "boolean") fields[k] = { booleanValue: v };
      else if (v === null) fields[k] = { nullValue: null };
      else if (Array.isArray(v)) {
        fields[k] = { arrayValue: { values: v.map(x => (typeof x === "string" ? { stringValue: x } : { stringValue: String(x) })) } };
      } else if (typeof v === "object") {
        fields[k] = { mapValue: { fields: toFields(v) } };
      } else fields[k] = { stringValue: String(v) };
    }
    return fields;
  }
  body.fields = toFields(dataObj);
  // try create with PATCH to support upsert-ish
  const res = await fetch(url + "?mask.fieldPaths=*", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  // fallback to POST to collection (if patch fails)
  const parent = docPath.split("/").slice(0, -1).join("/");
  return fetch(`${FIRESTORE_BASE}/${parent}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());
}

// Utility to increment numeric field (read-modify-write)
// Because Firestore REST lacks easy atomic increment without auth, we'll read doc then write.
// For brevity, we'll do read then set. This is acceptable for low load.
async function firestoreGetDoc(docPath) {
  const url = `${FIRESTORE_BASE}/${docPath}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = await res.json();
  // convert fields to JS object (simple)
  function fromFields(fields) {
    const obj = {};
    for (const k of Object.keys(fields || {})) {
      const v = fields[k];
      if (v.stringValue !== undefined) obj[k] = v.stringValue;
      else if (v.doubleValue !== undefined) obj[k] = Number(v.doubleValue);
      else if (v.integerValue !== undefined) obj[k] = Number(v.integerValue);
      else if (v.booleanValue !== undefined) obj[k] = v.booleanValue;
      else if (v.mapValue) obj[k] = fromFields(v.mapValue.fields);
      else obj[k] = null;
    }
    return obj;
  }
  return fromFields(json.fields || {});
}

async function firestoreSetDocSimple(docPath, jsObj) {
  // upsert by PATCH with mask
  const url = `${FIRESTORE_BASE}/${docPath}?mask.fieldPaths=*`;
  // convert to Firestore fields
  function toFields(obj) {
    const fields = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") fields[k] = { stringValue: v };
      else if (typeof v === "number") fields[k] = { doubleValue: v };
      else if (typeof v === "boolean") fields[k] = { booleanValue: v };
      else if (v === null) fields[k] = { nullValue: null };
      else if (Array.isArray(v)) {
        fields[k] = { arrayValue: { values: v.map(x => ({ stringValue: String(x) })) } };
      } else if (typeof v === "object") {
        fields[k] = { mapValue: { fields: toFields(v) } };
      } else fields[k] = { stringValue: String(v) };
    }
    return fields;
  }
  const body = { fields: toFields(jsObj) };
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// =====================================
// --- API Endpoints
// =====================================

app.get("/api/health", (req, res) => res.json({ ok: true }));

// balance read will be done by client directly via SDK; backend not needed for reads
// But we keep endpoints for compatibility:

// POST /api/notify-withdraw (not used; withdraw endpoint below handles)
// -------------------- Withdraw endpoint (client calls) --------------------
/**
 * body: { userId, wallet, amount }
 * Steps:
 *  - check user's balance (read doc)
 *  - deduct amount and create withdraw doc (collection: withdraws)
 *  - send Telegram message to ADMIN_CHAT_ID with inline keyboard approve/reject
 */
app.post("/api/withdraw", async (req, res) => {
  try {
    const { userId, wallet, amount } = req.body;
    if (!userId || !wallet || !amount) return res.status(400).json({ error: "Missing data" });
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    // get user doc
    const userDocPath = `users/${encodeURIComponent(userId)}`;
    const user = await firestoreGetDoc(userDocPath) || { balance: 0, referrals: 0 };
    if ((Number(user.balance) || 0) < amt) return res.status(400).json({ error: "Insufficient balance" });

    // deduct balance and update user
    const newBalance = (Number(user.balance) || 0) - amt;
    await firestoreSetDocSimple(userDocPath, { ...user, balance: newBalance });

    // create withdraw doc with generated id (use timestamp)
    const withdrawId = `w_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const withdrawDocPath = `withdraws/${withdrawId}`;
    const withdrawObj = {
      userId,
      wallet,
      amount: amt,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await firestoreSetDocSimple(withdrawDocPath, withdrawObj);

    // send admin message with inline keyboard
    const text = `💸 *Withdraw Request*\n👤 User: ${userId}\n💰 Amount: $${amt.toFixed(2)}\n🏦 Wallet: \`${wallet}\`\n\nID: \`${withdrawId}\``;
    const reply_markup = {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `approve_${withdrawId}` },
          { text: "❌ Reject", callback_data: `reject_${withdrawId}` },
        ],
      ],
    };

    const tgRes = await sendTelegramMessage(ADMIN_CHAT_ID, text, reply_markup);
    // store tg message details in withdraw doc if available
    try {
      const tgMsg = tgRes.result;
      if (tgMsg) {
        withdrawObj.tg_chat_id = tgMsg.chat.id.toString();
        withdrawObj.tg_message_id = tgMsg.message_id;
        await firestoreSetDocSimple(withdrawDocPath, withdrawObj);
      }
    } catch (e) {
      // ignore
    }

    return res.json({ success: true, withdrawId });
  } catch (e) {
    console.error("/api/withdraw error", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST /api/earn - called by client for ad/captcha
// body: { userId, type, amount }
app.post("/api/earn", async (req, res) => {
  try {
    const { userId, type, amount } = req.body;
    if (!userId || !type || !amount) return res.status(400).json({ error: "Missing data" });
    const amt = Number(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: "Invalid amount" });

    const userDocPath = `users/${encodeURIComponent(userId)}`;
    const user = await firestoreGetDoc(userDocPath) || { balance: 0, referrals: 0 };

    // credit user
    const newBalance = (Number(user.balance) || 0) + amt;
    await firestoreSetDocSimple(userDocPath, { ...user, balance: newBalance });

    // log earning
    const earnId = `e_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    await firestoreSetDocSimple(`earnings/${earnId}`, { userId, type, amount: amt, createdAt: new Date().toISOString() });

    // commission to referrer (10%)
    if (user.referrerId) {
      const commission = +(amt * 0.10);
      if (commission > 0) {
        const refDocPath = `users/${encodeURIComponent(user.referrerId)}`;
        const refUser = await firestoreGetDoc(refDocPath) || { balance: 0, referrals: 0 };
        const refNewBal = (Number(refUser.balance) || 0) + commission;
        await firestoreSetDocSimple(refDocPath, { ...refUser, balance: refNewBal });
        // log commission
        const cid = `c_${Date.now()}_${Math.floor(Math.random()*10000)}`;
        await firestoreSetDocSimple(`commissions/${cid}`, { referrerId: user.referrerId, from: userId, amount: commission, createdAt: new Date().toISOString() });
        // notify admin
        await sendTelegramMessage(ADMIN_CHAT_ID, `🔁 *Referral Commission*\n👥 Referrer: ${user.referrerId}\n👤 From User: ${userId}\n💰 Commission: $${commission.toFixed(8)}`);
      }
    }

    // notify admin about earning (optional)
    await sendTelegramMessage(ADMIN_CHAT_ID, `🪙 *Earning Activity*\n👤 User: ${userId}\n📘 Type: ${type}\n💰 Amount: $${amt.toFixed(8)}`);

    return res.json({ success: true });
  } catch (e) {
    console.error("/api/earn error", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/withdraws/:userId  - return withdraws (client displays history)
app.get("/api/withdraws/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    // Firestore REST: list documents under collection withdraws with simple filter not available unauthenticated; so we will fetch all withdraws and filter (small scale)
    const url = `${FIRESTORE_BASE}/withdraws`;
    const r = await fetch(url);
    const js = await r.json();
    const docs = (js.documents || []).map(d => {
      // parse fields
      const f = d.fields || {};
      function val(x) {
        if (!x) return null;
        if (x.stringValue !== undefined) return x.stringValue;
        if (x.doubleValue !== undefined) return Number(x.doubleValue);
        if (x.booleanValue !== undefined) return x.booleanValue;
        if (x.mapValue) return x.mapValue.fields;
        return null;
      }
      return {
        id: d.name.split("/").pop(),
        userId: val(f.userId),
        wallet: val(f.wallet),
        amount: val(f.amount),
        status: val(f.status),
        createdAt: val(f.createdAt)
      };
    });
    const filtered = docs.filter(w => w.userId === userId).sort((a,b)=> (b.createdAt || "").localeCompare(a.createdAt || ""));
    res.json({ withdraws: filtered });
  } catch (e) {
    console.error("/api/withdraws error", e);
    res.status(500).json({ error: "Server error" });
  }
});

// Webhook endpoint for Telegram updates (callback_query)
app.post("/api/webhook", async (req, res) => {
  try {
    const body = req.body;
    // handle callback_query
    if (body.callback_query) {
      const cb = body.callback_query;
      const data = cb.data; // e.g. "approve_w_123456"
      const from = cb.from;
      const message = cb.message;
      if (!data) {
        // answer callback
        await fetch(TELEGRAM_API("answerCallbackQuery"), {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ callback_query_id: cb.id, text: "No data" })
        });
        return res.sendStatus(200);
      }
      const [action, ...idParts] = data.split("_");
      const withdrawId = idParts.join("_");
      if (!withdrawId) return res.sendStatus(200);

      // get withdraw doc
      const wdoc = await firestoreGetDoc(`withdraws/${withdrawId}`);
      if (!wdoc) {
        await fetch(TELEGRAM_API("answerCallbackQuery"), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ callback_query_id: cb.id, text: "Withdraw not found." }) });
        return res.sendStatus(200);
      }

      if (action === "approve") {
        // set status approved
        await firestoreSetDocSimple(`withdraws/${withdrawId}`, { ...wdoc, status: "approved", processedAt: new Date().toISOString(), processedBy: String(from.id) });
        // edit admin message (if exists)
        if (message) {
          const newText = `💸 *Withdraw Request — APPROVED*\n👤 User: ${wdoc.userId}\n💰 Amount: $${Number(wdoc.amount).toFixed(2)}\n🏦 Wallet: \`${wdoc.wallet}\`\n\nID: \`${withdrawId}\``;
          try {
            await fetch(TELEGRAM_API("editMessageText"), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, text: newText, parse_mode: "Markdown" }) });
          } catch (e) {}
        }
        // notify user (bot can send direct message only if user started bot)
        try {
          await sendTelegramMessage(wdoc.userId, `✅ Your withdraw request of $${Number(wdoc.amount).toFixed(2)} has been *APPROVED*. Admin will process payout.` );
        } catch (e) {}
        await fetch(TELEGRAM_API("answerCallbackQuery"), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ callback_query_id: cb.id, text: "Approved" }) });
      } else if (action === "reject") {
        // set status rejected and refund amount
        await firestoreSetDocSimple(`withdraws/${withdrawId}`, { ...wdoc, status: "rejected", processedAt: new Date().toISOString(), processedBy: String(from.id) });
        // refund
        const userDocPath = `users/${encodeURIComponent(wdoc.userId)}`;
        const user = await firestoreGetDoc(userDocPath) || { balance: 0, referrals: 0 };
        const refundedBal = (Number(user.balance) || 0) + Number(wdoc.amount || 0);
        await firestoreSetDocSimple(userDocPath, { ...user, balance: refundedBal });
        // edit admin message
        if (message) {
          const newText = `💸 *Withdraw Request — REJECTED*\n👤 User: ${wdoc.userId}\n💰 Amount: $${Number(wdoc.amount).toFixed(2)}\n🏦 Wallet: \`${wdoc.wallet}\`\n\nID: \`${withdrawId}\``;
          try {
            await fetch(TELEGRAM_API("editMessageText"), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ chat_id: message.chat.id, message_id: message.message_id, text: newText, parse_mode: "Markdown" }) });
          } catch (e) {}
        }
        // notify user
        try {
          await sendTelegramMessage(wdoc.userId, `❌ Your withdraw request of $${Number(wdoc.amount).toFixed(2)} has been *REJECTED*. Amount refunded to your balance.` );
        } catch (e) {}
        await fetch(TELEGRAM_API("answerCallbackQuery"), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ callback_query_id: cb.id, text: "Rejected & refunded" }) });
      }

      return res.sendStatus(200);
    }

    // ignore other update types
    res.sendStatus(200);
  } catch (e) {
    console.error("webhook error", e);
    res.sendStatus(500);
  }
});

export default app;
