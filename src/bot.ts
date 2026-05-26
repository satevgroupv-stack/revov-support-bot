import { Telegraf, session, Context } from "telegraf";
import { message } from "telegraf/filters";
import express from "express";

// ---------- Environment validation ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_IDS_RAW = process.env.ADMIN_CHAT_IDS;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing");
  process.exit(1);
}
if (!ADMIN_CHAT_IDS_RAW) {
  console.error("❌ ADMIN_CHAT_IDS is missing");
  process.exit(1);
}
const ADMIN_CHAT_IDS = ADMIN_CHAT_IDS_RAW.split(",")
  .map(id => parseInt(id.trim()))
  .filter(id => !isNaN(id));
if (ADMIN_CHAT_IDS.length === 0) {
  console.error("❌ ADMIN_CHAT_IDS must contain at least one valid numeric ID");
  process.exit(1);
}
console.log(`📋 Configured admin IDs: ${ADMIN_CHAT_IDS.join(", ")}`);

// ---------- Active admins (auto‑register on startup) ----------
let activeAdmins: Set<number> = new Set(ADMIN_CHAT_IDS);
console.log(`✅ Auto‑registered ${activeAdmins.size} admin(s) on startup`);

// ---------- Session state ----------
type FlowStep = 
  | null
  | "tech_description"
  | "tech_phone"
  | "comment_text"
  | "comment_phone";

interface SessionData {
  language: "en" | "am";
  flowStep: FlowStep;
  tempData: {
    description?: string;
    commentText?: string;
  };
}

interface MyContext extends Context {
  session: SessionData;
}

// ---------- Language texts (same as before, omitted for brevity) ----------
// ... (keep your full texts object here) ...
// I'm omitting it to save space, but you must keep the entire `texts` object from your original code.

const replyMapping = new Map<number, number>();
const bot = new Telegraf<MyContext>(BOT_TOKEN);

// ---------- Helper: Forward any message to all active admins ----------
async function forwardToAdmins(
  ctx: MyContext,
  category: "TECHNICAL_ISSUE" | "COMMENT" | "FOLLOW_UP",
  extraInfo: { description?: string; phone?: string; commentText?: string },
  includeOriginalMessage: boolean = true
) {
  const user = ctx.from;
  if (!user) {
    console.error("❌ Cannot forward: ctx.from is missing");
    return;
  }
  const msg = ctx.message;
  if (!msg) {
    console.error("❌ Cannot forward: ctx.message is missing");
    return;
  }

  // Log the attempt
  console.log(`📤 Forwarding ${category} from user ${user.id} (${user.first_name}) to ${activeAdmins.size} admin(s)`);

  // If no active admins, try to fallback to raw ADMIN_CHAT_IDS
  if (activeAdmins.size === 0) {
    console.error("⚠️ activeAdmins is empty! Falling back to ADMIN_CHAT_IDS");
    for (const id of ADMIN_CHAT_IDS) {
      activeAdmins.add(id);
    }
    if (activeAdmins.size === 0) {
      console.error("❌ No admins available at all – cannot forward");
      await ctx.reply("⚠️ Support is currently unavailable. Please try again later.").catch(console.error);
      return;
    }
  }

  let metadata = `📢 NEW ${category}\n\n`;
  metadata += `👤 User: ${user.first_name} ${user.last_name || ""} (@${user.username || "N/A"})\n`;
  metadata += `🆔 ID: \`${user.id}\`\n`;
  metadata += `🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n`;
  metadata += `🕒 Time: ${new Date().toISOString()}\n\n`;

  const isTextMessage = 'text' in msg && msg.text;
  if (!(includeOriginalMessage && isTextMessage)) {
    if (extraInfo.description) metadata += `📝 Issue Description: ${extraInfo.description}\n`;
    if (extraInfo.commentText) metadata += `💬 Comment: ${extraInfo.commentText}\n`;
  }
  if (extraInfo.phone) metadata += `📞 Phone: ${extraInfo.phone}\n`;

  if (category === "TECHNICAL_ISSUE") metadata += "\n#issue #SATEV";
  else if (category === "COMMENT") metadata += "\n#comment #SATEV";

  // For each admin, send the message
  for (const adminId of activeAdmins) {
    try {
      if (!includeOriginalMessage) {
        const sent = await ctx.telegram.sendMessage(adminId, metadata, { parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (metadata only) to admin ${adminId}`);
      } else if (isTextMessage) {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + "\n" + msg.text, { parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (text) to admin ${adminId}`);
      } else if ('photo' in msg && msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption ? "\n📝 Caption: " + msg.caption : "");
        const sent = await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption, parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (photo) to admin ${adminId}`);
      } else if ('voice' in msg && msg.voice) {
        const sent = await ctx.telegram.sendVoice(adminId, msg.voice.file_id, { caption: metadata, parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        if (msg.caption) {
          const sentCap = await ctx.telegram.sendMessage(adminId, `📝 Caption: ${msg.caption}`, { parse_mode: "Markdown" });
          replyMapping.set(sentCap.message_id, user.id);
        }
        console.log(`✅ Sent ${category} (voice) to admin ${adminId}`);
      } else if ('video' in msg && msg.video) {
        const caption = metadata + (msg.caption ? "\n📝 Caption: " + msg.caption : "");
        const sent = await ctx.telegram.sendVideo(adminId, msg.video.file_id, { caption, parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (video) to admin ${adminId}`);
      } else if ('document' in msg && msg.document) {
        const caption = metadata + (msg.caption ? "\n📝 Caption: " + msg.caption : "");
        const sent = await ctx.telegram.sendDocument(adminId, msg.document.file_id, { caption, parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (document) to admin ${adminId}`);
      } else {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + "\nUnsupported message type", { parse_mode: "Markdown" });
        replyMapping.set(sent.message_id, user.id);
        console.log(`✅ Sent ${category} (unsupported) to admin ${adminId}`);
      }
    } catch (err) {
      console.error(`❌ Failed to forward to admin ${adminId}:`, err);
      // If sending fails, remove this admin from active set to avoid future errors
      if (err.error_code === 403 || err.message?.includes("bot was blocked")) {
        activeAdmins.delete(adminId);
        console.log(`🚫 Removed admin ${adminId} from active set (blocked/deleted)`);
      }
    }
  }
}

// ---------- Test admin connectivity on startup ----------
async function testAdminConnectivity() {
  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, "✅ Bot is online and you are registered as an admin. You will receive all user messages.");
      console.log(`📡 Connectivity test sent to admin ${adminId}`);
    } catch (err) {
      console.error(`⚠️ Cannot reach admin ${adminId}:`, err);
      activeAdmins.delete(adminId);
    }
  }
}

// ---------- The rest of your bot commands and handlers ----------
// (Keep all your existing commands: /start, /help, /adminstart, /adminlist, /reply, /resolve)
// Also keep showMainMenu, session middleware, action handlers, etc.
// Only change is in handleUserMessage – I'll add a log there.

async function handleUserMessage(ctx: MyContext) {
  if (!ctx.chat || !ctx.message) {
    console.error("Missing chat or message in update");
    return;
  }
  if (ctx.chat.type !== "private") return;

  const lang = ctx.session.language;
  const t = texts[lang];
  const step = ctx.session.flowStep;

  console.log(`📨 Received message from user ${ctx.from.id}, step = ${step}, text = ${'text' in ctx.message ? ctx.message.text : 'non-text'}`);

  // No active flow: treat as follow-up
  if (step === null) {
    console.log(`➡️ Forwarding as FOLLOW_UP`);
    await forwardToAdmins(ctx, "FOLLOW_UP", {});
    await ctx.reply(t.followUpConfirm);
    return;
  }

  // ... rest of your existing steps (tech_description, tech_phone, comment_text, comment_phone) ...
  // Keep them exactly as in your original code.
}

// ---------- Webhook / polling setup (unchanged) ----------
// ...

// After bot launch, test admin connectivity
bot.launch().then(() => {
  console.log("🤖 Bot launched");
  testAdminConnectivity();
}).catch(console.error);
