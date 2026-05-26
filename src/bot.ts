import { Telegraf, session, Context } from "telegraf";
import { message } from "telegraf/filters";
import express from "express";

// ---------- Environment variables with validation ----------
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_IDS_RAW = process.env.ADMIN_CHAT_IDS;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is missing in environment variables");
  process.exit(1);
}
if (!ADMIN_CHAT_IDS_RAW) {
  console.error("❌ ADMIN_CHAT_IDS is missing in environment variables");
  process.exit(1);
}
const ADMIN_CHAT_IDS = ADMIN_CHAT_IDS_RAW.split(",").map(id => parseInt(id.trim())).filter(id => !isNaN(id));
if (ADMIN_CHAT_IDS.length === 0) {
  console.error("❌ ADMIN_CHAT_IDS must contain at least one valid numeric ID");
  process.exit(1);
}

// ---------- In-memory store of active admins ----------
let activeAdmins: Set<number> = new Set();

// ---------- Conversation state ----------
interface SessionData {
  language: "en" | "am";
  waitingFor: "comment" | "tech_issue" | null;
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
    commentPrompt: "💬 Please send your comment (text, photo, voice, or video).",
    techIssuePrompt: "🛠 Please describe the technical issue (text, photo, voice, or video).",
    thanks: "✅ Thank you! Your message has been forwarded to our support team.",
    error: "❌ Something went wrong. Please try again.",
    adminStart: "✅ You are now registered as an active admin. You will receive all user messages.",
    adminAlready: "ℹ️ You are already an active admin.",
    adminReminder: "🔔 Admin reminder: please send /admin_start to this bot to start receiving user messages.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
  },
  am: {
    welcome: "እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦",
    mainMenu: "ዋና ምናሌ – ምን ማድረግ ይፈልጋሉ?",
    commentPrompt: "💬 እባክዎ አስተያየትዎን ይላኩ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)።",
    techIssuePrompt: "🛠 እባክዎ ቴክኒካል ችግሩን ይግለጹ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)።",
    thanks: "✅ እናመሰግናለን! መልእክትዎ ለድጋፍ ቡድናችን ተልኳል።",
    error: "❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    adminStart: "✅ እንደ ንቁ አስተዳዳሪ ተመዝግበዋል። ሁሉንም የተጠቃሚ መልእክቶች ይቀበላሉ።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ነዎት።",
    adminReminder: "🔔 ለአስተዳዳሪ ማሳሰቢያ፦ የተጠቃሚ መልእክቶችን መቀበል ለመጀመር እባክዎ /admin_start ይላኩ።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
  },
};

const replyMapping = new Map<number, number>();

// ---------- Bot instance (defined early so functions can use it) ----------
const bot = new Telegraf<MyContext>(BOT_TOKEN);

// ---------- Helper functions (now using bot, which is already defined) ----------
async function forwardUserMessageToAdmins(ctx: MyContext, category: string) {
  const user = ctx.from;
  if (!user) return;
  const msg = ctx.message;
  if (!msg) return;

  const metadata = `📢 NEW ${category.toUpperCase()}\n\n👤 User: ${user.first_name} ${user.last_name || ""} (@${user.username || "N/A"})\n🆔 ID: ${user.id}\n🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n🕒 Time: ${new Date().toISOString()}\n\n`;

  for (const adminId of activeAdmins) {
    try {
      if ('text' in msg && msg.text) {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + msg.text);
        replyMapping.set(sent.message_id, user.id);
      } 
      else if ('photo' in msg && msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } 
      else if ('voice' in msg && msg.voice) {
        const sent = await ctx.telegram.sendVoice(adminId, msg.voice.file_id, { caption: metadata });
        replyMapping.set(sent.message_id, user.id);
        if (msg.caption) {
          const sentCap = await ctx.telegram.sendMessage(adminId, `📝 Caption: ${msg.caption}`);
          replyMapping.set(sentCap.message_id, user.id);
        }
      } 
      else if ('video' in msg && msg.video) {
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendVideo(adminId, msg.video.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } 
      else if ('document' in msg && msg.document) {
        const caption = metadata + (msg.caption || "");
        const sent = await ctx.telegram.sendDocument(adminId, msg.document.file_id, { caption });
        replyMapping.set(sent.message_id, user.id);
      } 
      else {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + "Unsupported message type");
        replyMapping.set(sent.message_id, user.id);
      }
    } catch (err) {
      console.error(`Failed to forward to admin ${adminId}:`, err);
    }
  }
}

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

async function showMainMenu(ctx: MyContext) {
  const lang = ctx.session.language;
  const t = texts[lang];
  await ctx.reply(t.mainMenu, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Send a Comment", callback_data: "menu_comment" }],
        [{ text: "🛠 Report Technical Issue", callback_data: "menu_tech" }],
        [{ text: "🤖 Vending Machine Purchase", url: "https://example.com/order" }], // CHANGE THIS URL
      ],
    },
  });
}

// ---------- Session middleware ----------
bot.use(session({
  defaultSession: (): SessionData => ({ language: "en", waitingFor: null }),
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

// ---------- Start and language ----------
bot.start(async (ctx) => {
  ctx.session.language = "en";
  ctx.session.waitingFor = null;
  await ctx.reply(texts.en.welcome, {
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
  ctx.session.waitingFor = null;
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

bot.action("menu_comment", async (ctx) => {
  ctx.session.waitingFor = "comment";
  await ctx.answerCbQuery();
  await ctx.reply(texts[ctx.session.language].commentPrompt);
});

bot.action("menu_tech", async (ctx) => {
  ctx.session.waitingFor = "tech_issue";
  await ctx.answerCbQuery();
  await ctx.reply(texts[ctx.session.language].techIssuePrompt);
});

// ---------- Admin reply handler (text only) ----------
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

// ---------- User message handlers ----------
bot.on(message("text"), async (ctx) => {
  if (ctx.chat.type !== "private") return;
  if (ctx.message.text.startsWith("/")) return;
  if (ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
  } else {
    await showMainMenu(ctx);
  }
});

bot.on(message("photo"), async (ctx) => {
  if (ctx.chat.type === "private" && ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
  }
});

bot.on(message("voice"), async (ctx) => {
  if (ctx.chat.type === "private" && ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
  }
});

bot.on(message("video"), async (ctx) => {
  if (ctx.chat.type === "private" && ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
  }
});

bot.on(message("document"), async (ctx) => {
  if (ctx.chat.type === "private" && ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
  }
});

// ---------- Error handling ----------
bot.catch((err, ctx) => {
  console.error("Bot error:", err);
  ctx.reply("An error occurred. Please try again later.").catch(console.error);
});

// ---------- Webhook (Render) vs Polling (local) ----------
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
