import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const WELCOME_SUBJECT = "You’re in! 🚀 (And your LinkedIn game is about to change)";
const WELCOME_TEXT = `Hey there,

It’s official: you’ve just secured your spot on the LinkyAssistant waitlist.

I’m building this tool for one simple reason: engagement on LinkedIn is a superpower, but it shouldn't be a full-time job.

Here is what you get by being on this list:

Priority Access: You’ll be among the first to get the invite to download the extension before the public launch.

The Waitlist Perk: As a "thank you" for being early, you’ll receive a lifetime 50% discount on our Pro plan. You won't find this deal anywhere else later.

Insiders Updates: I'll send you a quick preview of the features we're polishing, so you can see how the AI mimics your unique tone of voice.

We’re working hard to get LinkyAssistant into your hands as soon as possible. Keep an eye on your inbox—your access link will arrive soon.

Welcome to the future of LinkedIn networking.

Best,

The Founder
LinkyAssistant
www.linkyassistant.com`;

export default async function handler(req, res) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;

    if (!supabaseUrl || !supabaseServiceRoleKey || !resendApiKey) {
        return res.status(500).json({ error: "Missing server environment variables" });
    }

    const { email, source } = req.body || {};
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedSource = String(source || "direct").trim().toLowerCase();

    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!isEmailValid) {
        return res.status(400).json({ error: "Invalid email" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const { error: insertError } = await supabase
        .from("utenti_waitlist")
        .insert([{ email: normalizedEmail, source: normalizedSource }]);

    if (insertError) {
        if (insertError.code === "23505") {
            return res.status(409).json({ error: "Already in waitlist", code: "23505" });
        }
        return res.status(500).json({ error: "Failed to save email" });
    }

    const resend = new Resend(resendApiKey);
    const { error: resendError } = await resend.emails.send({
        from: "Founder | LinkyAssistant <info@linkyassistant.com>",
        to: [normalizedEmail],
        subject: WELCOME_SUBJECT,
        text: WELCOME_TEXT
    });

    if (resendError) {
        return res.status(500).json({ error: "Email saved, but welcome email failed" });
    }

    return res.status(200).json({ ok: true });
}
