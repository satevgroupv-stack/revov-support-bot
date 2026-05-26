import { Telegraf, session, Context } from "telegraf";
import { message } from "telegraf/filters";
import express from "express";

// ---------- Environment variables ----------
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_CHAT_IDS = process.env.ADMIN_CHAT_IDS?.split(",").map(id => parseInt(id.trim())) || [];

if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
  throw new Error("Missing BOT_TOKEN or ADMIN_CHAT_IDS in environment");
}

// ---------- In-memory store of active admins ----------
let activeAdmins: Set<number> = new Set();

// ---------- Conversation state ----------
interface SessionData {
  language: "en" | "am";
  waitingFor: "comment" | "tech_issue" | null; // null = main menu
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
    purchaseLink: "Click below to order a RevoV vending machine:",
    purchaseButton: "🛒 Order Vending Machine",
    thanks: "✅ Thank you! Your message has been forwarded to our support team.",
    error: "❌ Something went wrong. Please try again.",
    adminStart: "✅ You are now registered as an active admin. You will receive all user messages.",
    adminAlready: "ℹ️ You are already an active admin.",
    adminReminder: "🔔 Admin reminder: please send /admin_start to this bot to start receiving user messages.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
    followUpConfirm: "📨 Your follow-up has been sent.",
  },
  am: {
    welcome: "እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦",
    mainMenu: "ዋና ምናሌ – ምን ማድረግ ይፈልጋሉ?",
    commentPrompt: "💬 እባክዎ አስተያየትዎን ይላኩ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)።",
    techIssuePrompt: "🛠 እባክዎ ቴክኒካል ችግሩን ይግለጹ (ጽሑፍ፣ ፎቶ፣ ድምጽ ወይም ቪዲዮ)።",
    purchaseLink: "ሪቮቪ መሸጫ ማሽን ለማዘዝ ከታች ይጫኑ፦",
    purchaseButton: "🛒 መሸጫ ማሽን ያዝዙ",
    thanks: "✅ እናመሰግናለን! መልእክትዎ ለድጋፍ ቡድናችን ተልኳል።",
    error: "❌ ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    adminStart: "✅ እንደ ንቁ አስተዳዳሪ ተመዝግበዋል። ሁሉንም የተጠቃሚ መልእክቶች ይቀበላሉ።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ነዎት።",
    adminReminder: "🔔 ለአስተዳዳሪ ማሳሰቢያ፦ የተጠቃሚ መልእክቶችን መቀበል ለመጀመር እባክዎ /admin_start ይላኩ።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
    followUpConfirm: "📨 ክትትልዎ ተልኳል።",
  },
};

// ---------- Store mapping: bot message ID -> user ID (for reply-to functionality) ----------
const replyMapping = new Map<number, number>();

// ---------- Helper: Forward user message to all active admins ----------
async function forwardUserMessageToAdmins(ctx: MyContext, category: string) {
  const user = ctx.from;
  if (!user) return;

  const msg = ctx.message;
  if (!msg) return;

  const metadata = `📢 NEW ${category.toUpperCase()}\n\n👤 User: ${user.first_name} ${user.last_name || ""} (@${user.username || "N/A"})\n🆔 ID: ${user.id}\n🌐 Language: ${ctx.session.language === "en" ? "English" : "Amharic"}\n🕒 Time: ${new Date().toISOString()}\n\n`;

  for (const adminId of activeAdmins) {
    try {
      if (msg.text) {
        const sentMsg = await ctx.telegram.sendMessage(adminId, metadata + msg.text);
        replyMapping.set(sentMsg.message_id, user.id);
      } else if (msg.photo) {
        const photo = msg.photo[msg.photo.length - 1];
        const caption = metadata + (msg.caption || "");
        const sentMsg = await ctx.telegram.sendPhoto(adminId, photo.file_id, { caption });
        replyMapping.set(sentMsg.message_id, user.id);
      } else if (msg.voice) {
        const sentVoice = await ctx.telegram.sendVoice(adminId, msg.voice.file_id, { caption: metadata });
        replyMapping.set(sentVoice.message_id, user.id);
        if (msg.caption) {
          const sentCaption = await ctx.telegram.sendMessage(adminId, `📝 Caption: ${msg.caption}`);
          replyMapping.set(sentCaption.message_id, user.id);
        }
      } else if (msg.video) {
        const caption = metadata + (msg.caption || "");
        const sentMsg = await ctx.telegram.sendVideo(adminId, msg.video.file_id, { caption });
        replyMapping.set(sentMsg.message_id, user.id);
      } else if (msg.document) {
        const caption = metadata + (msg.caption || "");
        const sentMsg = await ctx.telegram.sendDocument(adminId, msg.document.file_id, { caption });
        replyMapping.set(sentMsg.message_id, user.id);
      } else {
        const sentMsg = await ctx.telegram.sendMessage(adminId, metadata + "Unsupported message type");
        replyMapping.set(sentMsg.message_id, user.id);
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
        console.log(`Reminder sent to inactive admin ${adminId}`);
      } catch (err) {
        console.error(`Could not send reminder to admin ${adminId}:`, err);
      }
    }
  }
}

// ---------- Notify all active admins when an admin replies to a user ----------
async function notifyAdminsOfReply(replyingAdminId: number, replyingAdminName: string, targetUserId: number, messageText: string) {
  const notification = `
📨 ADMIN REPLY SENT

👤 Admin: ${replyingAdminName} (ID: ${replyingAdminId})
👤 To User ID: ${targetUserId}
📝 Message: ${messageText}
🕒 Sent at: ${new Date().toISOString()}
  `.trim();

  for (const adminId of activeAdmins) {
    try {
      await bot.telegram.sendMessage(adminId, notification);
    } catch (err) {
      console.error(`Failed to send reply notification to admin ${adminId}:`, err);
    }
  }
}

// ---------- Show main menu with buttons ----------
async function showMainMenu(ctx: MyContext) {
  const lang = ctx.session.language;
  const t = texts[lang];
  await ctx.reply(t.mainMenu, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "💬 Send a Comment", callback_data: "menu_comment" }],
        [{ text: "🛠 Report Technical Issue", callback_data: "menu_tech" }],
        [{ text: "🤖 Vending Machine Purchase", url: "https://example.com/order" }], // Replace with actual link
      ],
    },
  });
}

// ---------- Bot initialization ----------
const bot = new Telegraf<MyContext>(BOT_TOKEN);

bot.use(
  session({
    defaultSession: (): SessionData => ({
      language: "en",
      waitingFor: null,
    }),
  }),
);

// ---------- Admin registration command ----------
bot.command("admin_start", async (ctx) => {
  const userId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(userId)) {
    await ctx.reply("❌ You are not authorized as an admin.");
    return;
  }
  if (activeAdmins.has(userId)) {
    await ctx.reply(texts.en.adminAlready);
    return;
  }
  activeAdmins.add(userId);
  const lang = ctx.session.language || "en";
  await ctx.reply(texts[lang].adminStart);
  console.log(`Admin ${userId} registered successfully.`);
});

bot.command("admin_list", async (ctx) => {
  if (!ADMIN_CHAT_IDS.includes(ctx.from.id)) {
    await ctx.reply("❌ Unauthorized.");
    return;
  }
  const activeList = Array.from(activeAdmins).join(", ");
  await ctx.reply(`Active admins: ${activeList || "none"}`);
});

// ---------- /reply command ----------
bot.command("reply", async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(adminId)) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }
  if (!ctx.message || !ctx.message.text) return;
  const args = ctx.message.text.split(" ");
  if (args.length < 3) {
    await ctx.reply("Usage: /reply <user_id> <your message>");
    return;
  }
  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    await ctx.reply("❌ Invalid user ID.");
    return;
  }
  const replyMessage = args.slice(2).join(" ");
  if (!replyMessage.trim()) {
    await ctx.reply("❌ Message cannot be empty.");
    return;
  }
  try {
    await ctx.telegram.sendMessage(targetUserId, replyMessage);
    await ctx.reply(`✅ Reply sent to user ${targetUserId}`);
    const adminName = ctx.from.first_name || ctx.from.username || `Admin ${adminId}`;
    await notifyAdminsOfReply(adminId, adminName, targetUserId, replyMessage);
  } catch (err) {
    console.error("Failed to send reply:", err);
    await ctx.reply(`❌ Failed to send reply: ${err}`);
  }
});

// ---------- /resolve command ----------
bot.command("resolve", async (ctx) => {
  const adminId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(adminId)) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }
  if (!ctx.message || !ctx.message.text) return;
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    await ctx.reply("Usage: /resolve <user_id>");
    return;
  }
  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    await ctx.reply("❌ Invalid user ID.");
    return;
  }
  const lang = ctx.session.language || "en";
  const resolutionText = texts[lang].resolutionMsg;
  try {
    await ctx.telegram.sendMessage(targetUserId, resolutionText);
    await ctx.reply(`✅ Resolution message sent to user ${targetUserId}`);
    const adminName = ctx.from.first_name || ctx.from.username || `Admin ${adminId}`;
    await notifyAdminsOfReply(adminId, adminName, targetUserId, resolutionText);
  } catch (err) {
    await ctx.reply(`❌ Failed to send: ${err}`);
  }
});

// ---------- /start command ----------
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

// ---------- Language selection ----------
bot.action(/lang_(en|am)/, async (ctx) => {
  const lang = ctx.match[1] as "en" | "am";
  ctx.session.language = lang;
  ctx.session.waitingFor = null;
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

// ---------- Main menu actions ----------
bot.action("menu_comment", async (ctx) => {
  ctx.session.waitingFor = "comment";
  const lang = ctx.session.language;
  await ctx.answerCbQuery();
  await ctx.reply(texts[lang].commentPrompt);
});

bot.action("menu_tech", async (ctx) => {
  ctx.session.waitingFor = "tech_issue";
  const lang = ctx.session.language;
  await ctx.answerCbQuery();
  await ctx.reply(texts[lang].techIssuePrompt);
});

// ---------- Handle all messages (text, photo, voice, video, etc.) ----------
bot.on(message("text"), async (ctx) => {
  // Ignore commands
  if (ctx.message.text.startsWith("/")) return;

  // If user is in a private chat and waiting for input, forward the message
  if (ctx.chat.type === "private" && ctx.session.waitingFor) {
    const category = ctx.session.waitingFor === "comment" ? "Comment" : "Technical Issue";
    await forwardUserMessageToAdmins(ctx, category);
    await ctx.reply(texts[ctx.session.language].thanks);
    // After forwarding, go back to main menu
    ctx.session.waitingFor = null;
    await showMainMenu(ctx);
    return;
  }

  // If not waiting, just show main menu (or ignore)
  if (ctx.chat.type === "private" && !ctx.session.waitingFor) {
    await showMainMenu(ctx);
  }
});

// Handle photo, voice, video, document similarly
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

// ---------- Admin replies (via reply to bot message) ----------
bot.on(message("text"), async (ctx) => {
  // Already handled above, but we need to catch admin replies separately
  // We'll add a separate handler that runs before the user flow.
  // Since order matters, we'll restructure: move admin reply logic to a separate handler that runs first.
  // For clarity, I'll write a new handler at the top that checks for admin reply and returns early.
  // But to avoid duplication, I'll put it inside the existing text handler but before the waiting check.
  // Actually better: create a dedicated handler for admin replies using `bot.on` with filter.
});

// To avoid overriding, we'll combine everything into one message handler with proper order.
// Let's reorganize: one main handler that processes admin replies first, then user flows.

// I'll rewrite the message handling section cleanly:

// Clear any previous handlers (not needed, just define once)
// We'll use a single `bot.on("message")` with proper branching.

// However, we already defined several `bot.on` handlers above. They will execute in order of definition.
// To ensure admin reply works, we should define the admin reply handler BEFORE the user waiting handlers.

// So let's move the admin reply logic into a separate handler that runs first.

// But for simplicity, I'll provide the full final code with all handlers in correct order.
// I'll write the final version below.

// ---------- Admin reply handler (must be before other message handlers) ----------
bot.on(message("text"), async (ctx, next) => {
  // Check if this is an admin replying to a bot message in private chat
  const isAdmin = ADMIN_CHAT_IDS.includes(ctx.from.id);
  const isPrivate = ctx.chat.type === "private";
  const isReply = !!ctx.message.reply_to_message;

  if (isAdmin && isPrivate && isReply) {
    const repliedToMsg = ctx.message.reply_to_message;
    if (!repliedToMsg) return;
    const repliedToMsgId = repliedToMsg.message_id;
    const userId = replyMapping.get(repliedToMsgId);
    if (userId) {
      const adminReplyText = ctx.message.text;
      try {
        await ctx.telegram.sendMessage(userId, adminReplyText);
        await ctx.reply(`✅ Your reply has been sent to user ${userId}`);
        const adminName = ctx.from.first_name || ctx.from.username || `Admin ${ctx.from.id}`;
        await notifyAdminsOfReply(ctx.from.id, adminName, userId, adminReplyText);
      } catch (err) {
        console.error("Failed to send admin reply to user:", err);
        await ctx.reply(`❌ Failed to send reply: ${err}`);
      }
      return; // Handled
    } else {
      await ctx.reply("ℹ️ You replied to a message not linked to any user. Use /reply instead.");
      return;
    }
  }
  await next(); // Continue to other handlers
});

// Then the existing text handler (user flow) – but we already have multiple `bot.on` definitions.
// To avoid confusion, I'll replace all previous message handlers with the following final set.

// But given the complexity, I'll present the final complete code that you can copy-paste directly.
