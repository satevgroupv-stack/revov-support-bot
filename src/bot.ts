import { Telegraf, session, Context } from "telegraf";
import { message } from "telegraf/filters";

// ---------- Environment variables ----------
const BOT_TOKEN = process.env.BOT_TOKEN!;
const SUPPORT_GROUP_ID = process.env.SUPPORT_GROUP_ID!;

if (!BOT_TOKEN || !SUPPORT_GROUP_ID) {
  throw new Error("Missing BOT_TOKEN or SUPPORT_GROUP_ID in environment");
}

// ---------- Conversation state (MUST be defined BEFORE using it) ----------
interface SessionData {
  step: "language" | "phone" | "timeDay" | "product" | "description" | "done";
  language: "en" | "am";
  phone: string;
  timeDay: string;
  product: string;
  description: string;
  issueCategory?: string;
}

interface MyContext extends Context {
  session: SessionData;
}

// ---------- Language texts with proper TypeScript typing ----------
type LanguageKey = "en" | "am";
type TextKey = keyof typeof texts.en;

const texts: Record<LanguageKey, Record<string, string>> = {
  en: {
    welcome:
      "Welcome to RevoV Vending Machine Support! Please choose your language:",
    askPhone: "Please share your phone number:",
    askTimeDay: "What time and day did the issue happen? (e.g., Today at 3 PM)",
    askProduct: "What did you try to buy? (e.g., Coca-Cola, Water)",
    askDescription: "Please describe the problem in detail:",
    thanks: "Thank you! Your issue has been logged. Our team will review it.",
    instantFix_paymentFailed:
      "Your payment failed. Please try again or use another payment method.",
    instantFix_outOfStock:
      "This item is out of stock. Please select another product.",
    error: "Something went wrong. Please try again.",
    done: "✅ Your report has been sent to our support team (24/7). We'll follow up.",
    resolutionMsg:
      "✅ Your issue has been resolved. Thank you for using RevoV!",
  },
  am: {
    welcome: "እንኳን ወደ RevoV መሸጫ ማሽን ድጋፍ በደህና መጡ! እባክዎ ቋንቋዎን ይምረጡ፦",
    askPhone: "እባክዎ ስልክ ቁጥርዎን ያጋሩ፦",
    askTimeDay: "ችግሩ የደረሰበት ቀን እና ሰዓት ምንድነው? (ለምሳሌ፦ ዛሬ ከሰዓት 3)፦",
    askProduct: "ምን ለመግዛት ሞከሩ? (ለምሳሌ፦ ኮካ ኮላ፣ ውሃ)፦",
    askDescription: "እባክዎ ችግሩን በዝርዝር ይግለጹ፦",
    thanks: "እናመሰግናለን! ችግርዎ ተመዝግቧል። ቡድናችን ይገመግማል።",
    instantFix_paymentFailed:
      "ክፍያዎ አልተሳካም። እባክዎ እንደገና ይሞክሩ ወይም ሌላ የክፍያ ዘዴ ይጠቀሙ።",
    instantFix_outOfStock: "ይህ ምርት አልቀሯል። እባክዎ ሌላ ምርት ይምረጡ።",
    error: "ስህተት ተከስቷል። እባክዎ እንደገና ይሞክሩ።",
    done: "✅ ሪፖርትዎ ለድጋፍ ቡድናችን (24/7) ተልኳል። እንከታተላለን።",
    resolutionMsg: "✅ ችግርዎ ተፈትቷል። RevoV ስለተጠቀሙ እናመሰግናለን!",
  },
};

// ---------- Issue classification ----------
function classifyIssue(description: string, product: string): string {
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

// ---------- Forward to support group ----------
async function forwardToSupportGroup(
  ctx: MyContext,
  category: string,
  instantFixGiven: boolean,
) {
  const summary = `
📢 NEW ISSUE REPORT
Time of report: ${new Date().toISOString()}
User phone: ${ctx.session.phone}
Issue day/time (user said): ${ctx.session.timeDay}
Category: ${category}
Product: ${ctx.session.product}
Description: ${ctx.session.description}
Instant fix given: ${instantFixGiven ? "yes" : "no"}
Language: ${ctx.session.language === "en" ? "English" : "Amharic"}
  `.trim();
  try {
    await ctx.telegram.sendMessage(SUPPORT_GROUP_ID, summary);
    console.log("Forwarded to support group");
  } catch (err) {
    console.error("Failed to forward:", err);
  }
}

// ---------- Bot initialization (MUST be AFTER SessionData and MyContext are defined) ----------
const bot = new Telegraf<MyContext>(BOT_TOKEN);

bot.use(
  session({
    defaultSession: (): SessionData => ({
      step: "language",
      language: "en",
      phone: "",
      timeDay: "",
      product: "",
      description: "",
    }),
  }),
);

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
  ctx.session.step = "phone";
  await ctx.answerCbQuery();
  await ctx.reply(texts[lang].askPhone);
});

// Text handler
bot.on(message("text"), async (ctx) => {
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

  switch (step) {
    case "phone":
      ctx.session.phone = input;
      ctx.session.step = "timeDay";
      await ctx.reply(t.askTimeDay);
      break;
    case "timeDay":
      ctx.session.timeDay = input;
      ctx.session.step = "product";
      await ctx.reply(t.askProduct);
      break;
    case "product":
      ctx.session.product = input;
      ctx.session.step = "description";
      await ctx.reply(t.askDescription);
      break;
    case "description":
      ctx.session.description = input;
      const category = classifyIssue(input, ctx.session.product);
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
      await forwardToSupportGroup(ctx, category, instantFixGiven);
      ctx.session.step = "done";
      break;
    case "done":
      await ctx.reply(t.done);
      break;
    default:
      await ctx.reply(t.error);
      ctx.session.step = "phone";
      await ctx.reply(t.askPhone);
  }
});

// Resolve command (only in support group)
bot.command("resolve", async (ctx) => {
  if (ctx.chat.id.toString() !== SUPPORT_GROUP_ID) {
    await ctx.reply("This command can only be used in the support group.");
    return;
  }
  const args = ctx.message.text.split(" ");
  if (args.length < 2) {
    await ctx.reply("Usage: /resolve <user_telegram_id>");
    return;
  }
  const userId = parseInt(args[1]);
  if (isNaN(userId)) {
    await ctx.reply("Invalid user ID.");
    return;
  }
  try {
    await ctx.telegram.sendMessage(userId, texts.en.resolutionMsg);
    await ctx.reply(`Resolution message sent to user ${userId}`);
  } catch (err) {
    await ctx.reply(`Failed to send: ${err}`);
  }
});

bot.catch((err, ctx) => {
  console.error(err);
  ctx.reply("An error occurred. Please try again later.").catch(console.error);
});

bot.launch();
console.log("RevoV Support Bot is running...");
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
