import { Telegraf, session, Context } from "telegraf";
import { message } from "telegraf/filters";
import express from "express";

// ---------- Environment variables ----------
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_CHAT_IDS = process.env.ADMIN_CHAT_IDS?.split(",").map(id => parseInt(id.trim())) || [];

if (!BOT_TOKEN || ADMIN_CHAT_IDS.length === 0) {
  throw new Error("Missing BOT_TOKEN or ADMIN_CHAT_IDS in environment");
}

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

// ---------- Send initial report to admins ----------
async function sendToAdmins(ctx: MyContext, category: string, instantFixGiven: boolean) {
  const user = ctx.from;
  const report = `
📢 NEW ISSUE REPORT

👤 USER ACCOUNT INFO:
• Chat ID: ${user?.id}
• Username: @${user?.username || "N/A"}
• First Name: ${user?.first_name || "N/A"}
• Last Name: ${user?.last_name || "N/A"}
• Language Code: ${user?.language_code || "N/A"}

📞 Phone: ${ctx.session.phone}
📝 Description: ${ctx.session.description}
🏷️ Category: ${category}
⚡ Instant Fix Given: ${instantFixGiven ? "✅ Yes" : "❌ No"}
🌐 Bot Language: ${ctx.session.language === "en" ? "English" : "Amharic"}
🕒 Report Timestamp: ${new Date().toISOString()}
  `.trim();

  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await ctx.telegram.sendMessage(adminId, report);
      console.log(`Report sent to admin ${adminId}`);
    } catch (err) {
      console.error(`Failed to send to admin ${adminId}:`, err);
    }
  }
}

// ---------- Send follow-up message to admins ----------
async function sendFollowUpToAdmins(ctx: MyContext, followUpText: string) {
  const user = ctx.from;
  const followUpMsg = `
📨 FOLLOW-UP MESSAGE FROM USER

👤 USER ACCOUNT INFO:
• Chat ID: ${user?.id}
• Username: @${user?.username || "N/A"}
• First Name: ${user?.first_name || "N/A"}
• Last Name: ${user?.last_name || "N/A"}
• Language Code: ${user?.language_code || "N/A"}

📝 Message: ${followUpText}
🕒 Sent at: ${new Date().toISOString()}
  `.trim();

  for (const adminId of ADMIN_CHAT_IDS) {
    try {
      await ctx.telegram.sendMessage(adminId, followUpMsg);
      console.log(`Follow-up sent to admin ${adminId}`);
    } catch (err) {
      console.error(`Failed to send follow-up to admin ${adminId}:`, err);
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

// Start command - resets the conversation
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

// Text handler
bot.on(message("text"), async (ctx) => {
  const step = ctx.session.step;
  const lang = ctx.session.language;
  const t = texts[lang];

  // If step is "language" (no language chosen yet), show language picker
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

  // Handle the normal flow
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
    // User is sending a follow-up message after the initial report
    await sendFollowUpToAdmins(ctx, input);
    await ctx.reply(t.followUpConfirm);
  } else {
    // Fallback (should not happen)
    await ctx.reply(t.error);
    ctx.session.step = "description";
    await ctx.reply(t.askDescription);
  }
});

// Resolve command (only for admins)
bot.command("resolve", async (ctx) => {
  const userId = ctx.from.id;
  if (!ADMIN_CHAT_IDS.includes(userId)) {
    await ctx.reply("❌ Only admins can use this command.");
    return;
  }
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    await ctx.reply("Usage: /resolve <user_telegram_id>");
    return;
  }
  const targetUserId = parseInt(args[1]);
  if (isNaN(targetUserId)) {
    await ctx.reply("Invalid user ID.");
    return;
  }
  try {
    // Send resolution message in English (user's language not stored after session ends)
    await ctx.telegram.sendMessage(targetUserId, texts.en.resolutionMsg);
    await ctx.reply(`✅ Resolution message sent to user ${targetUserId}`);
  } catch (err) {
    await ctx.reply(`❌ Failed to send: ${err}`);
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
