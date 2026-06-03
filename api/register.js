import { createClient } from "@supabase/supabase-js";

const REDIRECT_URL = "https://linkyscout.linkyassistant.com";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setCors(res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req, res) {
    setCors(res);

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!supabaseUrl || !supabaseServiceRoleKey) {
            console.error("register: missing env vars");
            return res.status(500).json({ error: "Server misconfiguration" });
        }

        const { email } = req.body || {};
        const normalizedEmail = String(email || "").trim().toLowerCase();

        if (!EMAIL_REGEX.test(normalizedEmail)) {
            return res.status(400).json({ error: "Invalid email" });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

        const { data: existing, error: lookupError } = await supabase
            .from("user_subscriptions")
            .select("email")
            .eq("email", normalizedEmail)
            .maybeSingle();

        if (lookupError) {
            console.error("register: subscription lookup failed", lookupError);
            return res.status(500).json({ error: "Something went wrong. Please try again." });
        }

        if (existing) {
            return res.status(200).json({ ok: true, redirect: REDIRECT_URL });
        }

        const periodEnd = new Date();
        periodEnd.setDate(periodEnd.getDate() + 7);

        const { error: insertError } = await supabase.from("user_subscriptions").insert({
            email: normalizedEmail,
            plan: "trial",
            status: "active",
            stripe_customer_id: null,
            stripe_subscription_id: null,
            current_period_end: periodEnd.toISOString(),
            cancel_at_period_end: false
        });

        if (insertError) {
            console.error("register: insert failed", insertError);
            return res.status(500).json({ error: "Something went wrong. Please try again." });
        }

        return res.status(200).json({ ok: true, redirect: REDIRECT_URL });
    } catch (err) {
        console.error("register: unexpected error", err);
        return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
}
