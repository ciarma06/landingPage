import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const PRICE_CATALOG = {
    price_1TYY44AqaCXpBWedkYaGHxol: {
        type: "subscription",
        plan: "assistant",
        sub_credits: 0,
        msg_limit: 150
    },
    price_1TYY9FAqaCXpBWedvqKQQiYt: {
        type: "subscription",
        plan: "scout",
        sub_credits: 500,
        msg_limit: 0
    },
    price_1TYYFZAqaCXpBWedhRRHMiTd: {
        type: "subscription",
        plan: "bundle",
        sub_credits: 600,
        msg_limit: 500
    },
    price_1TYYa7AqaCXpBWed0KrcuLX7: {
        type: "pack",
        pack_credits: 100
    },
    price_1TYYe5AqaCXpBWedvIgOpNMS: {
        type: "pack",
        pack_credits: 500
    },
    price_1TYYfNAqaCXpBWedb5120RQs: {
        type: "pack",
        pack_credits: 1000
    }
};

const SUCCESS_URL = "https://linkyassistant.com/success.html?session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://linkyassistant.com/#pricing";

function isPromoActive() {
    const deadline = process.env.PROMO_DEADLINE_ISO;
    if (!deadline) return false;
    return new Date() < new Date(deadline);
}

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
        const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!stripeSecretKey || !supabaseUrl || !supabaseServiceRoleKey) {
            console.error("create-checkout: missing env vars");
            return res.status(500).json({ error: "Server misconfiguration" });
        }

        const { priceId, email } = req.body || {};

        if (!priceId || typeof priceId !== "string") {
            return res.status(400).json({ error: "Missing priceId" });
        }

        const priceInfo = PRICE_CATALOG[priceId];
        if (!priceInfo) {
            return res.status(400).json({ error: "Unknown priceId" });
        }

        const normalizedEmail = email ? String(email).trim().toLowerCase() : null;

        // Packs require the user to be logged in (email passed)
        // and to have an active scout or bundle subscription.
        if (priceInfo.type === "pack") {
            if (!normalizedEmail) {
                return res.status(401).json({ error: "Email required to buy a credit pack" });
            }

            const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
            if (!isValidEmail) {
                return res.status(400).json({ error: "Invalid email" });
            }

            const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
            const { data: subscription, error: subError } = await supabase
                .from("user_subscriptions")
                .select("plan, status")
                .eq("email", normalizedEmail)
                .maybeSingle();

            if (subError) {
                console.error("create-checkout: supabase subscription lookup failed", subError);
                return res.status(500).json({ error: "Could not verify subscription" });
            }

            const planAllowsPacks = subscription
                && subscription.status === "active"
                && (subscription.plan === "scout" || subscription.plan === "bundle");

            if (!planAllowsPacks) {
                return res.status(403).json({
                    error: "Credit packs require an active Scout or Bundle subscription"
                });
            }
        }

        const stripe = new Stripe(stripeSecretKey);

        const metadata = {
            type: priceInfo.type,
            ...(priceInfo.plan ? { plan: priceInfo.plan } : {}),
            ...(priceInfo.pack_credits != null ? { pack_credits: String(priceInfo.pack_credits) } : {}),
            ...(normalizedEmail ? { email: normalizedEmail } : {})
        };

        const sessionParams = {
            mode: priceInfo.type === "subscription" ? "subscription" : "payment",
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: SUCCESS_URL,
            cancel_url: CANCEL_URL,
            metadata
        };

        if (
            priceInfo.type === "subscription"
            && priceInfo.plan === "assistant"
            && isPromoActive()
        ) {
            const couponId = process.env.STRIPE_ASSISTANT_PROMO_COUPON_ID;
            if (couponId) {
                console.log("[checkout] applying assistant promo coupon");
                sessionParams.discounts = [{ coupon: couponId }];
            }
        } else if (
            priceInfo.type === "subscription"
            && (priceInfo.plan === "scout" || priceInfo.plan === "bundle")
        ) {
            sessionParams.allow_promotion_codes = true;
        }

        if (normalizedEmail) {
            sessionParams.customer_email = normalizedEmail;
        }

        if (priceInfo.type === "subscription") {
            sessionParams.subscription_data = { metadata };
        } else {
            sessionParams.payment_intent_data = { metadata };
        }

        const session = await stripe.checkout.sessions.create(sessionParams);

        return res.status(200).json({ url: session.url });
    } catch (err) {
        console.error("create-checkout: unexpected error", err);
        return res.status(500).json({ error: err.message || "Internal error" });
    }
}
