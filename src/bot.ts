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

// ---------- Active admins (those who sent /admin_start) ----------
let activeAdmins: Set<number> = new Set();

// ---------- Session state ----------
type FlowStep = 
  | null                           // main menu
  | "tech_description"             // waiting for description
  | "tech_phone"                   // waiting for phone number
  | "comment_text"                 // waiting for comment text
  | "comment_phone";               // waiting for optional phone

interface SessionData {
  language: "en" | "am";
  flowStep: FlowStep;
  tempData: {
    description?: string;   // for tech issue
    commentText?: string;   // for comment
  };
}

interface MyContext extends Context {
  session: SessionData;
}

// ---------- Language texts ----------
type LanguageKey = "en" | "am";

const texts: Record<LanguageKey, Record<string, string>> = {
  en: {
    welcome: "Welcome to RevoV Vending Machine Support! Please choose your language:",
    mainMenu: "Main Menu – what would you like to do?",
    techAskDescription: "🛠 Please describe the technical issue in detail (text, photo, voice, or video):",
    techAskPhone: "📞 Please share your phone number so we can contact you:",
    commentAskText: "💬 Please send your comment (text, photo, voice, or video):",
    commentAskPhone: "📞 Please share your phone number (optional). Type 'skip' to skip:",
    thanksTech: "✅ Thank you! Your technical issue has been forwarded to our support team.",
    thanksComment: "✅ Thank you! Your comment has been forwarded to our support team.",
    followUpConfirm: "📨 Your follow‑up message has been sent to the support team.",
    invalidInput: "❌ Invalid input. Please try again.",
    skipPhone: "⏭️ Phone number skipped.",
    error: "❌ Something went wrong. Please try again.",
    // Admin messages
    adminStart: "✅ You are now registered as an active admin. You will receive all user messages.",
    adminAlready: "ℹ️ You are already an active admin.",
    adminReminder: "🔔 Admin reminder: please send /admin_start to this bot to start receiving user messages.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
  },
  am: {
    welcome: "እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦",
    mainMenu: "ዋና ምናሌ – ምን ማድረግ ይፈልጋሉ?",
    techAskDescription: "🛠 እባክዎ ቴክኒካል ችግሩን በዝርዝር ይግለጹ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)፦",
    techAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (እንድናገኝዎት)፦",
    commentAskText: "💬 እባክዎ አስተያየትዎን ይላኩ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)፦",
    commentAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (አማራጭ ነው)። 'skip' ብለው መልስ መስጠት ይችላሉ፦",
    thanksTech: "✅ እናመሰግናለን! ቴክኒካል ችግርዎ ለድጋፍ ቡድናችን ተልኳል።",
    thanksComment: "✅ እናመሰግናለን! አስተያየትዎ ለድጋፍ ቡድናችን ተልኳል።",
    followUpConfirm: "📨 ክትትልዎ ተልኳል።",
    invalidInput: "❌ ልክ ያልሆነ ግብአት። እባክዎ እንደገና ይሞክሩ።",
    skipPhone: "⏭️ ስልክ ቁጥር ተዘልሏል።",
    error: "❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    adminStart: "✅ እንደ ንቁ አስተዳዳሪ ተመዝግበዋል። ሁሉንም የተጠቃሚ መልእክቶች ይቀበላሉ።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ነዎት።",
    adminReminder: "🔔 ለአስተዳዳሪ ማሳሰቢያ፦ የተጠቃሚ መልእክቶችን መቀበል ለመጀመር እባክዎ /admin_start ይላኩ።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
  },
};

const replyMapping = new Map<number, number>();
const bot = new Telegraf<MyContext>(BOT_TOKEN);

// ---------- Helper: Forward any message (text, photo, etc.) to all active admins ----------
async function forwardToAdmins(
  ctx: MyContext,
  category: "TECHNICAL_ISSUE" | "COMMENT" | "FOLLOW_UP",
  extraInfo: { description?: string; phone?: string; commentText?: string }
) {
  const user = ctx.from;
  if (!user) return;
  const msg = ctx.message;
  if (!msg) return;

  let metadata = `📢 NEW ${category}\n\n`;
  metadata += `👤 User: ${user.first_name} ${user.last_name || ""} (@${user.username || "N/A"})\n`;
  metadata += `🆔 ID: ${user.id}\n`;
  metadata += `🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n`;
  metadata += `🕒 Time: ${new Date().toISOString()}\n\n`;

  if (extraInfo.description) metadata += `📝 Issue Description: ${extraInfo.description}\n`;
  if (extraInfo.commentText) metadata += `💬 Comment: ${extraInfo.commentText}\n`;
  if (extraInfo.phone) metadata += `📞 Phone: ${extraInfo.phone}\n`;

  for (const adminId of activeAdmins) {
    try {
      if ('text' in msg && msg.text) {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + msg.text);
        replyMapping.set(sent.message_id, user.id);
      } else if ('photo' in msg && msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } else if ('voice' in msg && msg.voice) {
        const sent = await ctx.telegram.sendVoice(adminId, msg.voice.file_id, { caption: metadata });
        replyMapping.set(sent.message_id, user.id);
        if (msg.caption) {
          const sentCap = await ctx.telegram.sendMessage(adminId, `📝 Caption: ${msg.caption}`);
          replyMapping.set(sentCap.message_id, user.id);
        }
      } else if ('video' in msg && msg.video) {
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendVideo(adminId, msg.video.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } else if ('document' in msg && msg.document) {
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendDocument(adminId, msg.document.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } else {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + "Unsupported message type");
        replyMapping.set(sent.message_id, user.id);
      }
    } catch (err) {
      console.error(`Failed to forward to admin ${adminId}:`, err);
    }
  }
}

// ---------- Remind inactive admins ----------
async function remindInactiveAdmins() {
  for (const adminId of ADMIN_CHAT_IDS) {
    if (!activeAdmins.has(adminId)) {
      try {
        await bot.telegram.sendMessage(adminId, texts.en.adminReminder);
      } catch (err) {
        console.error(`Could not send reminder to admin ${adminId}:`, err);
      }
    }
  }
}

// ---------- Notify admins when a reply is sent ----------
async function notifyAdminsOfReply(replyingAdminId: number, replyingAdminName: string, targetUserId: number, messageText: string) {
  const notification = `📨 ADMIN REPLY SENT\n\n👤 Admin: ${replyingAdminName} (ID: ${replyingAdminId})\n👤 To User ID: ${targetUserId}\n📝 Message: ${messageText}\n🕒 Sent at: ${new Date().toISOString()}`;
  for (const adminId of activeAdmins) {
    try {
      await bot.telegram.sendMessage(adminId, notification);
    } catch (err) {
      console.error(`Failed to send reply notification to admin ${adminId}:`, err);
    }
  }
}

// ---------- Show main menu ----------
async function showMainMenu(ctx: MyContext) {
  const lang = ctx.session.language;
  const t = texts[lang];
  await ctx.reply(t.mainMenu, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Send a Comment", callback_data: "menu_comment" }],
        [{ text: "🛠 Report Technical Issue", callback_data: "menu_tech" }],
        [{ text: "🤖 Vending Machine Purchase", url: "https://example.com/order" }],
      ],
    },
  });
}

// ---------- Session middleware ----------
bot.use(session({
  defaultSession: (): SessionData => ({
    language: "en",
    flowStep: null,
    tempData: {},
  }),
}));

// ---------- Admin commands ----------
bot.command("admin_start", async (ctx) => {
  const userId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(userId)) return ctx.reply("❌ Unauthorized.");
  if (activeAdmins.has(userId)) return ctx.reply(texts[ctx.session.language].adminAlready);
  activeAdmins.add(userId);
  await ctx.reply(texts[ctx.session.language].adminStart);
});

bot.command("admin_list", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply("❌ Unauthorized.");
  await ctx.reply(`Active admins: ${Array.from(activeAdmins).join(", ") || "none"}`);
});

bot.command("reply", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply("❌ Only admins.");
  if (!ctx.message || !('text' in ctx.message)) return;
  const parts = ctx.message.text.split(" ");
  if (parts.length < 3) return ctx.reply("Usage: /reply <user_id> <message>");
  const targetUserId = parseInt(parts[1]);
  if (isNaN(targetUserId)) return ctx.reply("❌ Invalid user ID.");
  const replyMsg = parts.slice(2).join(" ");
  if (!replyMsg.trim()) return ctx.reply("❌ Message empty.");
  try {
    await ctx.telegram.sendMessage(targetUserId, replyMsg);
    await ctx.reply(`✅ Sent to user ${targetUserId}`);
    const adminName = ctx.from.first_name || ctx.from.username || `Admin ${ctx.from.id}`;
    await notifyAdminsOfReply(ctx.from.id, adminName, targetUserId, replyMsg);
  } catch (err) {
    await ctx.reply(`❌ Failed: ${err}`);
  }
});

bot.command("resolve", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply("❌ Only admins.");
  if (!ctx.message || !('text' in ctx.message)) return;
  const parts = ctx.message.text.split(" ");
  if (parts.length < 2) return ctx.reply("Usage: /resolve <user_id>");
  const targetUserId = parseInt(parts[1]);
  if (isNaN(targetUserId)) return ctx.reply("❌ Invalid user ID.");
  const resolutionText = texts[ctx.session.language].resolutionMsg;
  try {
    await ctx.telegram.sendMessage(targetUserId, resolutionText);
    await ctx.reply(`✅ Resolution sent to user ${targetUserId}`);
    const adminName = ctx.from.first_name || ctx.from.username || `Admin ${ctx.from.id}`;
    await notifyAdminsOfReply(ctx.from.id, adminName, targetUserId, resolutionText);
  } catch (err) {
    await ctx.reply(`❌ Failed: ${err}`);
  }
});

// ---------- /start command ----------
bot.start(async (ctx) => {
  ctx.session.language = "en";
  ctx.session.flowStep = null;
  ctx.session.tempData = {};
  await ctx.reply(texts.en.welcome, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇬🇧 English", callback_data: "lang_en" }],
        [{ text: "🇪🇹 አማርኛ", callback_data: "lang_am" }],
      ],
    },
  });
});

// ---------- Language selection ----------
bot.action(/lang_(en|am)/, async (ctx) => {
  const lang = ctx.match[1] as "en" | "am";
  ctx.session.language = lang;
  ctx.session.flowStep = null;
  ctx.session.tempData = {};
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

// ---------- Main menu actions ----------
bot.action("menu_comment", async (ctx) => {
  ctx.session.flowStep = "comment_text";
  ctx.session.tempData = {};
  await ctx.answerCbQuery();
  await ctx.reply(texts[ctx.session.language].commentAskText);
});

bot.action("menu_tech", async (ctx) => {
  ctx.session.flowStep = "tech_description";
  ctx.session.tempData = {};
  await ctx.answerCbQuery();
  await ctx.reply(texts[ctx.session.language].techAskDescription);
});

// ---------- Handle admin replies (direct reply to bot message) ----------
bot.on(message("text"), async (ctx, next) => {
  const isAdmin = ADMIN_CHAT_IDS.includes(ctx.from.id);
  const isPrivate = ctx.chat.type === "private";
  const isReply = !!ctx.message.reply_to_message;

  if (isAdmin && isPrivate && isReply) {
    const repliedTo = ctx.message.reply_to_message;
    if (repliedTo) {
      const userId = replyMapping.get(repliedTo.message_id);
      if (userId) {
        const replyText = ctx.message.text;
        try {
          await ctx.telegram.sendMessage(userId, replyText);
          await ctx.reply(`✅ Reply sent to user ${userId}`);
          const adminName = ctx.from.first_name || ctx.from.username || `Admin ${ctx.from.id}`;
          await notifyAdminsOfReply(ctx.from.id, adminName, userId, replyText);
        } catch (err) {
          await ctx.reply(`❌ Failed: ${err}`);
        }
        return;
      } else {
        await ctx.reply("ℹ️ This message is not linked to any user. Use /reply.");
        return;
      }
    }
  }
  await next();
});

// ---------- Generic message handler (text, photo, voice, video, document) ----------
async function handleUserMessage(ctx: MyContext) {
  if (ctx.chat.type !== "private") return;

  const lang = ctx.session.language;
  const t = texts[lang];
  const step = ctx.session.flowStep;

  // If no active flow, treat as follow-up
  if (step === null) {
    await forwardToAdmins(ctx, "FOLLOW_UP", {});
    await ctx.reply(t.followUpConfirm);
    return;
  }

  // Handle each flow step
  if (step === "tech_description") {
    // Store the description (can be text, photo, voice, etc.)
    const msg = ctx.message;
    let description = "";
    if (msg && 'text' in msg && msg.text) description = msg.text;
    else if (msg && 'caption' in msg && msg.caption) description = msg.caption;
    else description = "[Non‑text media]";
    
    ctx.session.tempData.description = description;
    ctx.session.flowStep = "tech_phone";
    await ctx.reply(t.techAskPhone);
    return;
  }

  if (step === "tech_phone") {
    if (!('text' in ctx.message)) {
      await ctx.reply(t.invalidInput);
      return;
    }
    const phone = ctx.message.text.trim();
    if (!phone) {
      await ctx.reply(t.invalidInput);
      return;
    }
    // Forward the complete tech issue
    await forwardToAdmins(ctx, "TECHNICAL_ISSUE", {
      description: ctx.session.tempData.description,
      phone: phone,
    });
    await ctx.reply(t.thanksTech);
    // Reset flow
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }

  if (step === "comment_text") {
    // Store the comment (text or media caption)
    const msg = ctx.message;
    let commentText = "";
    if (msg && 'text' in msg && msg.text) commentText = msg.text;
    else if (msg && 'caption' in msg && msg.caption) commentText = msg.caption;
    else commentText = "[Non‑text media]";
    
    ctx.session.tempData.commentText = commentText;
    ctx.session.flowStep = "comment_phone";
    await ctx.reply(t.commentAskPhone);
    return;
  }

  if (step === "comment_phone") {
    if (!('text' in ctx.message)) {
      await ctx.reply(t.invalidInput);
      return;
    }
    let phone = ctx.message.text.trim();
    if (phone.toLowerCase() === "skip") {
      phone = "";
      await ctx.reply(t.skipPhone);
    }
    await forwardToAdmins(ctx, "COMMENT", {
      commentText: ctx.session.tempData.commentText,
      phone: phone,
    });
    await ctx.reply(t.thanksComment);
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }
}

// Register handlers for all message types
bot.on(message("text"), async (ctx) => {
  if (ctx.message.text.startsWith("/")) return; // skip commands
  await handleUserMessage(ctx);
});
bot.on(message("photo"), handleUserMessage);
bot.on(message("voice"), handleUserMessage);
bot.on(message("video"), handleUserMessage);
bot.on(message("document"), handleUserMessage);

// ---------- Error handling ----------
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  ctx.reply("An error occurred. Please try again later.").catch(console.error);
});

// ---------- Webhook / Polling ----------
const isRender = !!process.env.RENDER;
if (isRender) {
  const PORT = parseInt(process.env.PORT || "3000");
  const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
  bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`✅ Webhook set to ${WEBHOOK_URL}`);
  }).catch(console.error);
  const app = express();
  app.use(express.json());
  app.post("/webhook", async (req, res) => {
    try {
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      res.sendStatus(500);
    }
  });
  app.listen(PORT, () => console.log(`🚀 Webhook server on port ${PORT}`));
} else {
  bot.launch();
  console.log("🤖 Bot running in polling mode");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
