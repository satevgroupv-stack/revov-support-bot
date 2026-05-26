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
  step: "language" | "description" | "phone" | "done";
  language: "en" | "am";
  phone: string;
  description: string;
  issueCategory?: string;
}

interface MyContext extends Context {
  session: SessionData;
}

// ---------- Language texts ----------
type LanguageKey = "en" | "am";

const texts: Record<LanguageKey, Record<string, string>> = {
  en: {
    welcome:
      "Welcome to RevoV Vending Machine Support! Please choose your language / እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ:",
    askDescription: "Please describe the problem in detail:",
    askPhone: "Please share your phone number:",
    thanks: "Thank you! Your issue has been logged. Our team will review it.",
    instantFix_paymentFailed:
      "Your payment failed. Please try again or use another payment method.",
    instantFix_outOfStock:
      "This item is out of stock. Please select another product.",
    error: "Something went wrong. Please try again.",
    done: "✅ Your report has been sent to our support team (24/7). We'll follow up.",
    resolutionMsg: "✅ Your issue has been resolved. Thank you for using RevoV!",
    followUpConfirm: "📨 Your follow-up message has been sent to the support team.",
    adminStart: "✅ You are now registered as an active admin. You will receive all user reports and replies.",
    adminAlready: "ℹ️ You are already an active admin.",
    adminReminder: "🔔 Admin reminder: please send /admin_start to this bot to start receiving user reports.",
  },
  am: {
    welcome:
      "Welcome to RevoV Vending Machine Support! Please choose your language / እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ:",
    askDescription: "እባክዎ ችግሩን በዝርዝር ይግለጹ፦",
    askPhone: "እባክዎ ስልክ ቁጥርዎን ያጋሩ፦",
    thanks: "እናመሰግናለን! ችግርዎ ተመዝግቧል። ቡድናችን ይገመግማል።",
    instantFix_paymentFailed:
      "ክፍያዎ አልተሳካም። እባክዎ እንደገና ይሞክሩ ወይም ሌላ የክፍያ ዘዴ ይጠቀሙ።",
    instantFix_outOfStock: "ይህ ምርት አልቀሯል። እባክዎ ሌላ ምርት ይምረጡ።",
    error: "ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    done: "✅ ሪፖርትዎ ለድጋፍ ቡድናችን (24/7) ተልኳል። እንከታተላለን።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
    followUpConfirm: "📨 የክትትል መልእክትዎ ለድጋፍ ቡድን ተልኳል።",
    adminStart: "✅ እንደ ንቁ አስተዳዳሪ ተመዝግበዋል። ሁሉንም የተጠቃሚ ሪፖርቶች እና ምላሾች ይቀበላሉ።",
    adminAlready: "ℹ️ ቀድሞውንም ንቁ አስተዳዳሪ ነዎት።",
    adminReminder: "🔔 ለአስተዳዳሪ ማሳሰቢያ፦ የተጠቃሚ ሪፖርቶችን መቀበል ለመጀመር እባክዎ /admin_start ይላኩ።",
  },
};

// ---------- Issue classification ----------
function classifyIssue(description: string): string {
  const lowerDesc = description.toLowerCase();
  if (
    lowerDesc.includes("payment") ||
    lowerDesc.includes("pay") ||
    lowerDesc.includes("failed") ||
    lowerDesc.includes("lakipay")
  )
    return "payment error";
  if (
    lowerDesc.includes("out of stock") ||
    lowerDesc.includes("not available") ||
    lowerDesc.includes("empty")
  )
    return "out of stock";
  if (
    lowerDesc.includes("network") ||
    lowerDesc.includes("wifi") ||
    lowerDesc.includes("connection")
  )
    return "network issue";
  if (
    lowerDesc.includes("electrical") ||
    lowerDesc.includes("interference") ||
    lowerDesc.includes("grounding")
  )
    return "electrical interference";
  if (
    lowerDesc.includes("dispense") ||
    lowerDesc.includes("stuck") ||
    lowerDesc.includes("not coming out")
  )
    return "dispensing failure";
  if (
    lowerDesc.includes("machine") ||
    lowerDesc.includes("frozen") ||
    lowerDesc.includes("crash")
  )
    return "machine malfunction";
  return "other";
}

// ---------- Store mapping: bot message ID -> user ID ----------
const replyMapping = new Map<number, number>();

// ---------- Helper: Send a message to all active admins ----------
async function sendToAllActiveAdmins(ctx: MyContext, text: string, userId: number) {
  for (const adminId of activeAdmins) {
    try {
      const sentMsg = await ctx.telegram.sendMessage(adminId, text);
      replyMapping.set(sentMsg.message_id, userId);
      console.log(`Stored mapping: adminMsg ${sentMsg.message_id} -> user ${userId}`);
    } catch (err) {
      console.error(`Failed to send to admin ${adminId}:`, err);
    }
  }
}

// ---------- Remind inactive admins ----------
async function remindInactiveAdmins(ctx: MyContext) {
  for (const adminId of ADMIN_CHAT_IDS) {
    if (!activeAdmins.has(adminId)) {
      try {
        await ctx.telegram.sendMessage(adminId, texts.en.adminReminder);
        console.log(`Reminder sent to inactive admin ${adminId}`);
      } catch (err) {
        console.error(`Could not send reminder to admin ${adminId}:`, err);
      }
    }
  }
}

// ---------- Send initial report to all active admins ----------
async function sendToAdmins(ctx: MyContext, category: string, instantFixGiven: boolean) {
  const user = ctx.from;
  if (!user) return;
  const report = `
📢 NEW ISSUE REPORT

👤 USER ACCOUNT INFO:
• Chat ID: ${user.id}
• Username: @${user.username || "N/A"}
• First Name: ${user.first_name || "N/A"}
• Last Name: ${user.last_name || "N/A"}
• Language Code: ${user.language_code || "N/A"}

📞 Phone: ${ctx.session.phone}
📝 Description: ${ctx.session.description}
🏷️ Category: ${category}
⚡ Instant Fix Given: ${instantFixGiven ? "✅ Yes" : "❌ No"}
🌐 Bot Language: ${ctx.session.language === "en" ? "English" : "Amharic"}
🕒 Report Timestamp: ${new Date().toISOString()}
  `.trim();

  await sendToAllActiveAdmins(ctx, report, user.id);
  await remindInactiveAdmins(ctx);
}

// ---------- Send follow-up message to all active admins ----------
async function sendFollowUpToAdmins(ctx: MyContext, followUpText: string) {
  const user = ctx.from;
  if (!user) return;
  const followUpMsg = `
📨 FOLLOW-UP MESSAGE FROM USER

👤 USER ACCOUNT INFO:
• Chat ID: ${user.id}
• Username: @${user.username || "N/A"}
• First Name: ${user.first_name || "N/A"}
• Last Name: ${user.last_name || "N/A"}
• Language Code: ${user.language_code || "N/A"}

📝 Message: ${followUpText}
🕒 Sent at: ${new Date().toISOString()}
  `.trim();

  await sendToAllActiveAdmins(ctx, followUpMsg, user.id);
  await remindInactiveAdmins(ctx);
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
      console.log(`Reply notification sent to admin ${adminId}`);
    } catch (err) {
      console.error(`Failed to send reply notification to admin ${adminId}:`, err);
    }
  }
}

// ---------- Bot initialization ----------
const bot = new Telegraf<MyContext>(BOT_TOKEN);

bot.use(
  session({
    defaultSession: (): SessionData => ({
      step: "language",
      language: "en",
      phone: "",
      description: "",
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

// Start command
bot.start(async (ctx) => {
  ctx.session.step = "language";
  await ctx.reply(texts.en.welcome, {
    reply_markup: {
      inline_keyboard: [
        [{ text: "English", callback_data: "lang_en" }],
        [{ text: "አማርኛ", callback_data: "lang_am" }],
      ],
    },
  });
});

// Language selection
bot.action(/lang_(en|am)/, async (ctx) => {
  const lang = ctx.match[1] as "en" | "am";
  ctx.session.language = lang;
  ctx.session.step = "description";
  await ctx.answerCbQuery();
  await ctx.reply(texts[lang].askDescription);
});

// /reply command
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
    await ctx.reply("❌ Invalid user ID. Must be a number.");
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

// /resolve command
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
  const resolutionText = texts.en.resolutionMsg;
  try {
    await ctx.telegram.sendMessage(targetUserId, resolutionText);
    await ctx.reply(`✅ Resolution message sent to user ${targetUserId}`);
    const adminName = ctx.from.first_name || ctx.from.username || `Admin ${adminId}`;
    await notifyAdminsOfReply(adminId, adminName, targetUserId, resolutionText);
  } catch (err) {
    await ctx.reply(`❌ Failed to send: ${err}`);
  }
});

// ----- Handle all text messages -----
bot.on(message("text"), async (ctx) => {
  // Ignore commands (already handled)
  if (ctx.message.text.startsWith("/")) return;

  const isAdmin = ADMIN_CHAT_IDS.includes(ctx.from.id);
  const isPrivate = ctx.chat.type === "private";
  const isReply = !!ctx.message.reply_to_message;

  // Admin replying to a bot message in private chat
  if (isAdmin && isPrivate && isReply) {
    const repliedToMsg = ctx.message.reply_to_message;
    if (!repliedToMsg) {
      await ctx.reply("ℹ️ You replied to a message that doesn't exist.");
      return;
    }
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
      return;
    } else {
      await ctx.reply("ℹ️ You replied to a message that is not linked to any user. Use /reply <user_id> <message> if you want to send a custom reply.");
      return;
    }
  }

  // If not admin or not a reply, handle normal user flow only in private chats
  if (ctx.chat.type !== "private") return;

  const step = ctx.session.step;
  const lang = ctx.session.language;
  const t = texts[lang];

  if (step === "language") {
    await ctx.reply(t.welcome, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "English", callback_data: "lang_en" }],
          [{ text: "አማርኛ", callback_data: "lang_am" }],
        ],
      },
    });
    return;
  }

  const input = ctx.message.text.trim();

  if (step === "description") {
    ctx.session.description = input;
    ctx.session.step = "phone";
    await ctx.reply(t.askPhone);
  } else if (step === "phone") {
    ctx.session.phone = input;
    const category = classifyIssue(ctx.session.description);
    let instantFixGiven = false;
    let replyText = "";
    if (category === "payment error") {
      replyText = t.instantFix_paymentFailed;
      instantFixGiven = true;
    } else if (category === "out of stock") {
      replyText = t.instantFix_outOfStock;
      instantFixGiven = true;
    } else {
      replyText = t.thanks;
    }
    await ctx.reply(replyText);
    await ctx.reply(t.done);
    await sendToAdmins(ctx, category, instantFixGiven);
    ctx.session.step = "done";
  } else if (step === "done") {
    await sendFollowUpToAdmins(ctx, input);
    await ctx.reply(t.followUpConfirm);
  } else {
    await ctx.reply(t.error);
    ctx.session.step = "description";
    await ctx.reply(t.askDescription);
  }
});

bot.catch((err, ctx) => {
  console.error(err);
  ctx.reply("An error occurred. Please try again later.").catch(console.error);
});

// ---------- Webhook (Render) vs Polling (local) ----------
const isRender = !!process.env.RENDER;

if (isRender) {
  const PORT = parseInt(process.env.PORT || "3000");
  const WEBHOOK_URL = `https://${process.env.RENDER_EXTERNAL_HOSTNAME}/webhook`;

  bot.telegram.setWebhook(WEBHOOK_URL).then(() => {
    console.log(`✅ Webhook set to ${WEBHOOK_URL}`);
  });

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
  app.listen(PORT, () => {
    console.log(`🚀 Webhook server listening on port ${PORT}`);
  });
} else {
  bot.launch();
  console.log("🤖 RevoV Support Bot is running in polling mode (local)");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
