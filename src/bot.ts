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

// ---------- Active admins – all configured admins are automatically active ----------
let activeAdmins: Set<number> = new Set(ADMIN_CHAT_IDS);
console.log(`✅ Auto-activated admins: ${Array.from(activeAdmins).join(", ")}`);

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

// ---------- Language texts ----------
type LanguageKey = "en" | "am";

const texts: Record<LanguageKey, Record<string, string>> = {
  en: {
    welcome: `*Welcome to RevoV Vending Machine Support! Please choose your language:*\n *እንኳን ወደ RevoVending ማሽን በደህና መጡ! እባክዎ ቋንቋ ይምረጡ *`,
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
    adminStart: "✅ You are already an active admin (all configured admins are automatically active).",
    adminAlready: "ℹ️ You are already an active admin.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
    help: `ℹ️ *Available Commands*

👤 *User Commands*
/start – Restart the bot and choose language
Then use the main menu buttons:
• 💬 Send a Comment – Share feedback or questions
• 🛠 Report Technical Issue – Describe a problem (we'll ask for your phone)
• 🤖 Order a Drink – Visit our order page

👑 *Admin Commands* (only for authorised admins)
/adminlist – See all configured admins (all are automatically active)
/reply <user_id> <message> – Send a private reply to a user
/resolve <user_id> – Send a resolution message to a user

💡 *Tip*: As an admin, you can also reply directly to any forwarded user message – the bot will automatically send your reply to that user.`,
  },
  am: {
    welcome: "እንኳን ወደ RevoV ራስ-ሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦",
    mainMenu: "ዋና ማውጫ – ምን ማድረግ ይፈልጋሉ?",
    mainMenuComment: "💬 አስተያየት ይላኩን",
    mainMenuTech: "🛠 ቴክኒካል ችግር ለማመልከት",
    mainMenuOrder: "🤖 መጠጥ ያዝዙ",
    techAskDescription: "🛠 እባክዎ ቴክኒካል ችግሩን በዝርዝር ይግለጹ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ መጠቀም ይችላሉ)፦",
    techAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (እንድናገኝዎት)፦",
    commentAskText: "💬 እባክዎ አስተያየትዎን ይላኩ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)፦",
    commentAskPhone: "📞 እባክዎ ስልክ ቁጥርዎን ያጋሩ (የግዴታ አይደለም ነው)። ለማለፍ 'skip' ብለው ይላኩ፦",
    thanksTech: `✅ እናመሰግናለን! ቴክኒካል ችግርዎ ለድጋፍ ቡድናችን ተልኳል። \nቻናላችንን ይቀላቀሉ @Satev_Group #SATEV`,
    thanksComment: `✅ እናመሰግናለን! አስተያየትዎ ለድጋፍ ቡድናችን ተልኳል።\nቻናላችንን ይቀላቀሉ @Satev_Group #SATEV`,
    followUpConfirm: "📨 ተጨማሪ መልእክትዎ ተልኳል።",
    invalidInput: "❌ ልክ ያልሆነ ቁልፍ ተጭነዋል። እባክዎ እንደገና ይሞክሩ።",
    skipPhone: "⏭️ ስልክ ቁጥር አላኩም።",
    error: "❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    adminStart: "✅ እርስዎ ቀድሞውንም ንቁ አስተዳዳሪ ነዎት (ሁሉም የተዋቀሩ አስተዳዳሪዎች በራስ-ሰር ንቁ ናቸው)።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ኖት።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
    help: `ℹ️ *በዚህ ቦት የሚገኙ ትዕዛዞች*

👤 *የተጠቃሚ ትዕዛዞች*
/start – ቦቱን እንደገና ይጀምሩ እና ቋንቋ ይምረጡ
ከዚያ በዋና ምናሌው ውስጥ ያሉትን አዝራሮች ይጠቀሙ፦
• 💬 አስተያየት ይላኩ – አስተያየት ወይም ጥያቄ ያጋሩ
• 🛠 ቴክኒካል ችግር ያመልክቱ – ችግሩን ይግለጹ (ስልክ ቁጥር እንጠይቃለን)
• 🤖 መጠጥ ለማዘዝ – የማዘዣ ገጻችንን ይጎብኙ

👑 *የአስተዳዳሪ ትዕዛዞች* (ለተፈቀዱ አስተዳዳሪዎች ብቻ)
/adminlist – ሁሉንም የተዋቀሩ አስተዳዳሪዎች ይመልከቱ (ሁሉም በራስ-ሰር ንቁ ናቸው)
/reply <user_id> <message> – ለተጠቃሚ የግል ምላሽ ይላኩ
/resolve <user_id> – ለተጠቃሚ ችግሩ መፈታቱን የሚገልጽ መልእክት ይላኩ`
  },
};

const replyMapping = new Map<number, number>();
const bot = new Telegraf<MyContext>(BOT_TOKEN);

// ---------- Helper: Escape HTML special characters ----------
function escapeHtml(str: string): string {
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ---------- Helper: Build clickable user ID with monospace formatting ----------
function userLink(userId: number, firstName: string): string {
  const safeName = escapeHtml(firstName || `User ${userId}`);
  return `<a href="tg://user?id=${userId}">🆔 <code>${userId}</code> (${safeName})</a>`;
}

// ---------- Helper: Forward any message to all active admins (with clickable user ID) ----------
// ---------- Helper: Forward any message to all active admins (with clickable user info) ----------
async function forwardToAdmins(
  ctx: MyContext,
  category: "TECHNICAL_ISSUE" | "COMMENT" | "FOLLOW_UP",
  extraInfo: { description?: string; phone?: string; commentText?: string },
  includeOriginalMessage: boolean = true
) {
  const user = ctx.from;
  if (!user) return;
  const msg = ctx.message;
  if (!msg) return;

  // Escape user details for HTML
  const safeFirstName = escapeHtml(user.first_name);
  const safeLastName = escapeHtml(user.last_name || "");
  const fullName = `${safeFirstName} ${safeLastName}`.trim();
  const username = user.username ? escapeHtml(user.username) : null;

  // Build user info block
  let userInfo = `👤 <a href="tg://user?id=${user.id}">${fullName}</a>\n`;
  if (username) {
    userInfo += `📱 <a href="https://t.me/${username}">@${username}</a>\n`;
  } else {
    userInfo += `📱 N/A\n`;
  }
  userInfo += `🆔 <a href="tg://user?id=${user.id}"><code>${user.id}</code></a>\n`;
  userInfo += `🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n`;
  userInfo += `🕒 Time: ${new Date().toISOString()}\n`;

  let metadata = `📢 <b>NEW ${category}</b>\n\n${userInfo}\n`;

  if (extraInfo.description) metadata += `📝 Issue Description: ${escapeHtml(extraInfo.description)}\n`;
  if (extraInfo.commentText) metadata += `💬 Comment: ${escapeHtml(extraInfo.commentText)}\n`;
  if (extraInfo.phone) metadata += `📞 Phone: ${escapeHtml(extraInfo.phone)}\n`;

  if (category === "TECHNICAL_ISSUE") metadata += "\n#issue #REVOV #SATEV";
  else if (category === "COMMENT") metadata += "\n#comment #REVOV #SATEV";

  for (const adminId of activeAdmins) {
    try {
      if (!includeOriginalMessage) {
        // Send only metadata
        const sent = await ctx.telegram.sendMessage(adminId, metadata, { parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      } else if ('text' in msg && msg.text) {
        const fullMsg = metadata + `\n📨 <b>User's message:</b>\n${escapeHtml(msg.text)}`;
        const sent = await ctx.telegram.sendMessage(adminId, fullMsg, { parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      } else if ('photo' in msg && msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption ? `\n📝 Caption: ${escapeHtml(msg.caption)}` : "");
        const sent = await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption, parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      } else if ('voice' in msg && msg.voice) {
        const sent = await ctx.telegram.sendVoice(adminId, msg.voice.file_id, { caption: metadata, parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
        if (msg.caption) {
          const sentCap = await ctx.telegram.sendMessage(adminId, `📝 Caption: ${escapeHtml(msg.caption)}`, { parse_mode: "HTML" });
          replyMapping.set(sentCap.message_id, user.id);
        }
      } else if ('video' in msg && msg.video) {
        const caption = metadata + (msg.caption ? `\n📝 Caption: ${escapeHtml(msg.caption)}` : "");
        const sent = await ctx.telegram.sendVideo(adminId, msg.video.file_id, { caption, parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      } else if ('document' in msg && msg.document) {
        const caption = metadata + (msg.caption ? `\n📝 Caption: ${escapeHtml(msg.caption)}` : "");
        const sent = await ctx.telegram.sendDocument(adminId, msg.document.file_id, { caption, parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      } else {
        const sent = await ctx.telegram.sendMessage(adminId, metadata + "\n❌ Unsupported message type", { parse_mode: "HTML" });
        replyMapping.set(sent.message_id, user.id);
      }
    } catch (err) {
      console.error(`Failed to forward to admin ${adminId}:`, err);
    }
  }
}

// ---------- Notify admins when a reply is sent ----------
async function notifyAdminsOfReply(replyingAdminId: number, replyingAdminName: string, targetUserId: number, messageText: string) {
  const notification = `📨 <b>ADMIN REPLY SENT</b>\n\n` +
                       `👤 Admin: ${escapeHtml(replyingAdminName)} (ID: ${replyingAdminId})\n` +
                       `👤 To User: ${userLink(targetUserId, `User ${targetUserId}`)}\n` +
                       `📝 Message: ${escapeHtml(messageText)}\n` +
                       `🕒 Sent at: ${new Date().toISOString()}`;
  for (const adminId of activeAdmins) {
    try {
      await bot.telegram.sendMessage(adminId, notification, { parse_mode: "HTML" });
    } catch (err) {
      console.error(`Failed to send reply notification to admin ${adminId}:`, err);
    }
  }
}

// ---------- Show main menu with translated buttons ----------
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

// ---------- Session middleware ----------
bot.use(session({
  defaultSession: (): SessionData => ({
    language: "en",
    flowStep: null,
    tempData: {},
  }),
}));

// ---------- Help command ----------
bot.command("help", async (ctx) => {
  const lang = ctx.session.language;
  const t = texts[lang];
  await ctx.reply(t.help, { parse_mode: "Markdown" });
});

// ---------- Admin commands ----------
// /adminstart now just informs that admins are already active
bot.command("adminstart", async (ctx) => {
  const userId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(userId)) return ctx.reply("❌ Unauthorized.");
  await ctx.reply(texts[ctx.session.language].adminStart);
});

// /adminlist shows all configured admins (all are active)
bot.command("adminlist", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) return ctx.reply("❌ Unauthorized.");
  let msg = "👑 <b>All configured admins are automatically active:</b>\n\n";
  for (const id of ADMIN_CHAT_IDS) {
    msg += `• ${userLink(id, `Admin ${id}`)}\n`;
  }
  await ctx.reply(msg, { parse_mode: "HTML" });
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
  const isPrivate = ctx.chat?.type === "private";
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

// ---------- Generic message handler ----------
async function handleUserMessage(ctx: MyContext) {
  if (!ctx.chat || !ctx.message) {
    console.error("Missing chat or message in update");
    return;
  }
  if (ctx.chat.type !== "private") return;

  const lang = ctx.session.language;
  const t = texts[lang];
  const step = ctx.session.flowStep;

  if (step === null) {
    await forwardToAdmins(ctx, "FOLLOW_UP", {});
    await ctx.reply(t.followUpConfirm);
    return;
  }

  if (step === "tech_description") {
    const msg = ctx.message;
    let description = "";
    let isMedia = false;

    if ('text' in msg && msg.text) {
      description = msg.text;
      isMedia = false;
    } else if ('caption' in msg && msg.caption) {
      description = msg.caption;
      isMedia = true;
    } else if ('photo' in msg) {
      description = "📷 Photo (see below)";
      isMedia = true;
    } else if ('voice' in msg) {
      description = "🎤 Voice message";
      isMedia = true;
    } else if ('video' in msg) {
      description = "🎥 Video";
      isMedia = true;
    } else if ('document' in msg) {
      description = "📄 Document";
      isMedia = true;
    } else {
      description = "[Unsupported media type]";
      isMedia = true;
    }

    ctx.session.tempData.description = description;
    await forwardToAdmins(ctx, "TECHNICAL_ISSUE", { description }, true);
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
    await forwardToAdmins(ctx, "TECHNICAL_ISSUE", {
      description: ctx.session.tempData.description,
      phone: phone,
    }, false);
    await ctx.reply(t.thanksTech);
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }

  if (step === "comment_text") {
    const msg = ctx.message;
    let commentText = "";
    let isMedia = false;

    if ('text' in msg && msg.text) {
      commentText = msg.text;
      isMedia = false;
    } else if ('caption' in msg && msg.caption) {
      commentText = msg.caption;
      isMedia = true;
    } else if ('photo' in msg) {
      commentText = "📷 Photo (see below)";
      isMedia = true;
    } else if ('voice' in msg) {
      commentText = "🎤 Voice message";
      isMedia = true;
    } else if ('video' in msg) {
      commentText = "🎥 Video";
      isMedia = true;
    } else if ('document' in msg) {
      commentText = "📄 Document";
      isMedia = true;
    } else {
      commentText = "[Unsupported media type]";
      isMedia = true;
    }

    ctx.session.tempData.commentText = commentText;
    await forwardToAdmins(ctx, "COMMENT", { commentText }, true);
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
    }, false);
    await ctx.reply(t.thanksComment);
    ctx.session.flowStep = null;
    ctx.session.tempData = {};
    await showMainMenu(ctx);
    return;
  }
}

// Register handlers for all message types (skip commands)
bot.on(message("text"), async (ctx) => {
  if (ctx.message.text.startsWith("/")) return;
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

// ---------- Startup notification: automatically list admins ----------
async function notifyAllAdminsOnStartup() {
  const startupMsg = "🤖 *RevoV Support Bot Started*\n\n" +
                     "👑 *All configured admins are automatically active*\n" +
                     "No need to send /adminstart. You will receive all user messages.\n\n" +
                     "📋 *Configured admin IDs:*\n" +
                     ADMIN_CHAT_IDS.map(id => `• \`${id}\``).join("\n") +
                     "\n\nℹ️ Use `/adminlist` to see this list again.\n" +
                     "Use `/reply <user_id> <msg>` or reply directly to forwarded messages.";
  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await bot.telegram.sendMessage(adminId, startupMsg, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(`Could not send startup message to admin ${adminId}:`, err);
    }
  }
}

// ---------- Webhook / Polling with keep‑alive (self‑ping) ----------
const isRender = !!process.env.RENDER;
if (isRender) {
  const PORT = parseInt(process.env.PORT || "3000");
  const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;
  bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`✅ Webhook set to ${WEBHOOK_URL}`);
  }).catch(console.error);

  const app = express();
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  app.post("/webhook", async (req, res) => {
    try {
      await bot.handleUpdate(req.body);
      res.sendStatus(200);
    } catch (err) {
      console.error("Webhook error:", err);
      res.sendStatus(500);
    }
  });

  const server = app.listen(PORT, async () => {
    console.log(`🚀 Webhook server on port ${PORT}`);
    await notifyAllAdminsOnStartup();
  });

  const publicHost = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (publicHost) {
    const pingUrl = `https://${publicHost}/health`;
    console.log(`🔄 Self‑ping enabled: ${pingUrl} every 60 seconds`);
    setInterval(async () => {
      try {
        const response = await fetch(pingUrl);
        if (!response.ok) console.warn(`Self‑ping returned ${response.status}`);
        else console.log("💓 Self‑ping successful");
      } catch (err) {
        console.error("Self‑ping failed:", err);
      }
    }, 60000);
  } else {
    console.warn("⚠️ RENDER_EXTERNAL_HOSTNAME not set, self‑ping disabled");
  }
} else {
  bot.launch().then(() => {
    console.log("🤖 Bot running in polling mode");
    notifyAllAdminsOnStartup();
  });
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
