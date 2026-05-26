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

// ---------- Active admins ----------
let activeAdmins: Set<number> = new Set(ADMIN_CHAT_IDS);
console.log(`✅ Auto‑registered ${activeAdmins.size} admin(s): ${Array.from(activeAdmins).join(", ")}`);

// ---------- Session state ----------
type FlowStep = null | "tech_description" | "tech_phone" | "comment_text" | "comment_phone";

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

// ---------- Language texts ----------
const texts: Record<"en" | "am", Record<string, string>> = {
  en: {
    welcome: "*Welcome to RevoV Vending Machine Support! Please choose your language:*\n*እንኳን ወደ RevoVending ማሽን በደህና መጡ! እባክዎ ቋንቋ ይምረጡ*",
    mainMenu: "Main Menu – what would you like to do?",
    mainMenuComment: "💬 Send a Comment",
    mainMenuTech: "🛠 Report Technical Issue",
    mainMenuOrder: "🤖 Order a Drink",
    techAskDescription: "🛠 Please describe the technical issue in detail (text, photo, voice, or video):",
    techAskPhone: "📞 Please share your phone number so we can contact you:",
    commentAskText: "💬 Please send your comment (text, photo, voice, or video):",
    commentAskPhone: "📞 Please share your phone number (optional). Type 'skip' to skip:",
    thanksTech: `✅ Thank you! Your technical issue has been forwarded to our support team. \nJoin The channel @Satev_Group #SATEV`,
    thanksComment: `✅ Thank you! Your comment has been forwarded to our support team. \nJoin The channel @Satev_Group #SATEV`,
    followUpConfirm: "📨 Your follow‑up message has been sent to the support team.",
    invalidInput: "❌ Invalid input. Please try again.",
    skipPhone: "⏭️ Phone number skipped.",
    error: "❌ Something went wrong. Please try again.",
    adminStart: "✅ You are now registered as an active admin.",
    adminAlready: "ℹ️ You are already an active admin.",
    adminReminder: "🔔 Admin reminder: please send /adminstart to this bot to start receiving user messages.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
    help: `ℹ️ *Available Commands* ...` // (keep your original help text)
  },
  am: {
    // ... keep your Amharic texts as they are
    welcome: "*እንኳን ወደ RevoV ራስ-ሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦*\n*Welcome to RevoV Vending Machine Support! Please choose your language:*",
    mainMenu: "ዋና ማውጫ – ምን ማድረግ ይፈልጋሉ?",
    mainMenuComment: "💬 አስተያየት ይላኩን",
    mainMenuTech: "🛠 ቴክኒካል ችግር ለማመልከት",
    mainMenuOrder: "🤖 መጠጥ ለማዝዙ",
    techAskDescription: "🛠 እባክዎ ቴክኒካል ችግሩን በዝርዝር ይግለጹ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)፦",
    techAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (እንድናገኝዎት)፦",
    commentAskText: "💬 እባክዎ አስተያየትዎን ይላኩ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)፦",
    commentAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (የግዴታ አይደለም ነው)። ለማለፍ 'skip' ብለው ይላኩ፦",
    thanksTech: "✅ እናመሰግናለን! ቴክኒካል ችግርዎ ለድጋፍ ቡድናችን ተልኳል። \nቻናላችንን ይቀላቀሉ @Satev_Group #SATEV",
    thanksComment: "✅ እናመሰግናለን! አስተያየትዎ ለድጋፍ ቡድናችን ተልኳል።\nቻናላችንን ይቀላቀሉ @Satev_Group #SATEV",
    followUpConfirm: "📨 ተጨማሪ መልእክትዎ ተልኳል።",
    invalidInput: "❌ ልክ ያልሆነ ቁልፍ ተጭነዋል። እባክዎ እንደገና ይሞክሩ።",
    skipPhone: "⏭️ ስልክ ቁጥር አላኩም።",
    error: "❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    adminStart: "✅ እንደ ንቁ አስተዳዳሪ ተመዝግበዋል።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ኖት።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
    help: `ℹ️ *በዚህ ቦት የሚገኙ ትዕዛዞች* ...` // keep your full help text
  },
};

// ---------- Reply Mapping ----------
const replyMapping = new Map<number, number>();

const bot = new Telegraf<MyContext>(BOT_TOKEN);

// ==================== IMPROVED FORWARD FUNCTION ====================
async function forwardToAdmins(
  ctx: MyContext,
  category: "TECHNICAL_ISSUE" | "COMMENT" | "FOLLOW_UP",
  extraInfo: { description?: string; phone?: string; commentText?: string } = {}
) {
  const user = ctx.from;
  if (!user || !ctx.message) return;

  if (activeAdmins.size === 0) {
    ADMIN_CHAT_IDS.forEach(id => activeAdmins.add(id));
  }

  let metadata = `📢 NEW ${category}\n\n`;
  metadata += `👤 User: ${user.first_name} ${user.last_name || ""} (@${user.username || "N/A"})\n`;
  metadata += `🆔 ID: \`${user.id}\`\n`;
  metadata += `🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n`;
  metadata += `🕒 Time: ${new Date().toISOString()}\n\n`;

  if (extraInfo.description) metadata += `📝 Description: ${extraInfo.description}\n`;
  if (extraInfo.commentText) metadata += `💬 Comment: ${extraInfo.commentText}\n`;
  if (extraInfo.phone) metadata += `📞 Phone: ${extraInfo.phone}\n`;

  if (category === "TECHNICAL_ISSUE") metadata += "\n#issue #SATEV";
  else if (category === "COMMENT") metadata += "\n#comment #SATEV";
  else if (category === "FOLLOW_UP") metadata += "\n#followup #SATEV";

  const msg = ctx.message;

  for (const adminId of activeAdmins) {
    try {
      if ('text' in msg && msg.text) {
        await ctx.telegram.sendMessage(adminId, metadata + msg.text, { parse_mode: "Markdown" });
      }
      else if ('photo' in msg && msg.photo?.length) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption ? `\n📝 Caption: ${msg.caption}` : "");
        await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption, parse_mode: "Markdown" });
      }
      else if ('voice' in msg && msg.voice) {
        await ctx.telegram.sendVoice(adminId, msg.voice.file_id, {
          caption: metadata + (msg.caption ? `\n📝 Caption: ${msg.caption}` : ""),
          parse_mode: "Markdown"
        });
      }
      else if ('video' in msg && msg.video) {
        await ctx.telegram.sendVideo(adminId, msg.video.file_id, {
          caption: metadata + (msg.caption ? `\n📝 Caption: ${msg.caption}` : ""),
          parse_mode: "Markdown"
        });
      }
      else if ('document' in msg && msg.document) {
        await ctx.telegram.sendDocument(adminId, msg.document.file_id, {
          caption: metadata + (msg.caption ? `\n📝 Caption: ${msg.caption}` : ""),
          parse_mode: "Markdown"
        });
      }
      else {
        await ctx.telegram.sendMessage(adminId, metadata + "\n\n⚠️ Unsupported message type", { parse_mode: "Markdown" });
      }

      // Send phone separately if needed
      if (extraInfo.phone) {
        await ctx.telegram.sendMessage(adminId, `📞 Phone: ${extraInfo.phone}`, { parse_mode: "Markdown" });
      }
    } catch (err: any) {
      console.error(`Failed to forward to admin ${adminId}:`, err.message || err);
      if (err.error_code === 403 || err.message?.includes("blocked") || err.message?.includes("chat not found")) {
        activeAdmins.delete(adminId);
        console.log(`🚫 Removed blocked admin: ${adminId}`);
      }
    }
  }
}

// ==================== HELPER FUNCTIONS ====================
async function showMainMenu(ctx: MyContext) {
  const lang = ctx.session.language;
  const t = texts[lang];
  await ctx.reply(t.mainMenu, {
    reply_markup: {
      inline_keyboard: [
        [{ text: t.mainMenuComment, callback_data: "menu_comment" }],
        [{ text: t.mainMenuTech, callback_data: "menu_tech" }],
        [{ text: t.mainMenuOrder, url: "https://satev.vercel.app/mch_sk_4740ed6ce010137901ba3580ff6cd85e" }],
      ],
    },
  });
}

// ==================== ADMIN REPLY HANDLER ====================
bot.on(message("text"), async (ctx, next) => {
  const isAdmin = ADMIN_CHAT_IDS.includes(ctx.from.id);
  const isPrivate = ctx.chat?.type === "private";
  const isReply = !!ctx.message.reply_to_message;

  if (isAdmin && isPrivate && isReply) {
    const repliedTo = ctx.message.reply_to_message;
    const userId = replyMapping.get(repliedTo.message_id);

    if (userId) {
      const replyText = ctx.message.text;
      try {
        await ctx.telegram.sendMessage(userId, replyText);
        await ctx.reply(`✅ Reply sent to user \`${userId}\``, { parse_mode: "Markdown" });
      } catch (err: any) {
        await ctx.reply(`❌ Failed: ${err.message}`);
      }
      return;
    }
  }
  await next();
});

// ==================== HANDLE USER MESSAGES ====================
async function handleUserMessage(ctx: MyContext) {
  if (ctx.chat?.type !== "private" || !ctx.message) return;

  const lang = ctx.session.language;
  const t = texts[lang];
  const step = ctx.session.flowStep;

  // === FOLLOW-UP ===
  if (step === null) {
    await forwardToAdmins(ctx, "FOLLOW_UP");
    await ctx.reply(t.followUpConfirm);
    return;
  }

  // === TECHNICAL ISSUE ===
  if (step === "tech_description") {
    let description = "";
    if ('text' in ctx.message && ctx.message.text) description = ctx.message.text;
    else if ('caption' in ctx.message && ctx.message.caption) description = ctx.message.caption;
    else if ('photo' in ctx.message) description = "📷 Photo attached";
    else if ('voice' in ctx.message) description = "🎤 Voice message";
    else if ('video' in ctx.message) description = "🎥 Video attached";
    else if ('document' in ctx.message) description = "📄 Document attached";

    ctx.session.tempData.description = description;
    await forwardToAdmins(ctx, "TECHNICAL_ISSUE", { description });
    ctx.session.flowStep = "tech_phone";
    await ctx.reply(t.techAskPhone);
    return;
  }

  if (step === "tech_phone") {
    if (!('text' in ctx.message)) return ctx.reply(t.invalidInput);
    const phone = ctx.message.text.trim();
    await forwardToAdmins(ctx, "TECHNICAL_ISSUE", {
      description: ctx.session.tempData.description,
      phone
    });
    await ctx.reply(t.thanksTech);
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }

  // === COMMENT ===
  if (step === "comment_text") {
    let commentText = "";
    if ('text' in ctx.message && ctx.message.text) commentText = ctx.message.text;
    else if ('caption' in ctx.message && ctx.message.caption) commentText = ctx.message.caption;
    else if ('photo' in ctx.message) commentText = "📷 Photo attached";
    else if ('voice' in ctx.message) commentText = "🎤 Voice message";
    else if ('video' in ctx.message) commentText = "🎥 Video attached";
    else if ('document' in ctx.message) commentText = "📄 Document attached";

    ctx.session.tempData.commentText = commentText;
    await forwardToAdmins(ctx, "COMMENT", { commentText });
    ctx.session.flowStep = "comment_phone";
    await ctx.reply(t.commentAskPhone);
    return;
  }

  if (step === "comment_phone") {
    if (!('text' in ctx.message)) return ctx.reply(t.invalidInput);
    let phone = ctx.message.text.trim();
    if (phone.toLowerCase() === "skip") {
      phone = "";
      await ctx.reply(t.skipPhone);
    }
    await forwardToAdmins(ctx, "COMMENT", {
      commentText: ctx.session.tempData.commentText,
      phone
    });
    await ctx.reply(t.thanksComment);
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }
}

// Register all message types
bot.on(["message", "photo", "voice", "video", "document"], async (ctx) => {
  if (ctx.message && 'text' in ctx.message && ctx.message.text?.startsWith("/")) return;
  await handleUserMessage(ctx);
});

// ---------- Commands & Actions (keep the rest same) ----------
bot.command("help", async (ctx) => {
  await ctx.reply(texts[ctx.session.language].help, { parse_mode: "Markdown" });
});

bot.command("adminstart", async (ctx) => {
  const userId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(userId)) return ctx.reply("❌ Unauthorized.");
  if (activeAdmins.has(userId)) return ctx.reply(texts[ctx.session.language].adminAlready);
  activeAdmins.add(userId);
  await ctx.reply(texts[ctx.session.language].adminStart);
});

bot.command("adminlist", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply("❌ Unauthorized.");
  const list = Array.from(activeAdmins).map(id => `\`${id}\``).join(", ");
  await ctx.reply(`Active admins: ${list || "none"}`, { parse_mode: "Markdown" });
});

bot.command("reply", async (ctx) => { /* keep your original */ });
bot.command("resolve", async (ctx) => { /* keep your original */ });

bot.start(async (ctx) => {
  ctx.session.language = "en";
  ctx.session.flowStep = null;
  ctx.session.tempData = {};
  await ctx.reply(texts.en.welcome, {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇬🇧 English", callback_data: "lang_en" }],
        [{ text: "🇪🇹 አማርኛ", callback_data: "lang_am" }],
      ],
    },
  });
});

bot.action(/lang_(en|am)/, async (ctx) => {
  const lang = ctx.match[1] as "en" | "am";
  ctx.session.language = lang;
  ctx.session.flowStep = null;
  ctx.session.tempData = {};
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

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

// ---------- Error handling & Launch ----------
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  ctx.reply("An error occurred. Please try again later.").catch(console.error);
});

// Webhook / Polling (keep your existing part)
const isRender = !!process.env.RENDER;
if (isRender) {
  // ... your existing webhook code
} else {
  bot.launch();
  console.log("🤖 Bot running in polling mode");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
