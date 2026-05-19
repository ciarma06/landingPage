import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { SignJWT } from "jose";

export const config = {
    api: { bodyParser: false }
};

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
    price_1TYYa7AqaCXpBWed0KrcuLX7: { type: "pack", pack_credits: 100 },
    price_1TYYe5AqaCXpBWedvIgOpNMS: { type: "pack", pack_credits: 500 },
    price_1TYYfNAqaCXpBWedb5120RQs: { type: "pack", pack_credits: 1000 }
};

const PLAN_LABELS = {
    assistant: "Linky Assistant",
    scout: "Linky Scout",
    bundle: "Linky Ultimate Bundle"
};

const SCOUT_APP_URL = "https://linkyscout.linkyassistant.com";
const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/";

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks);
}

function priceFromSubscription(subscription) {
    const item = subscription?.items?.data?.[0];
    return item?.price?.id || null;
}

function planFromPriceId(priceId) {
    const info = PRICE_CATALOG[priceId];
    return info?.plan || null;
}

async function signAuthToken({ email, plan, secret }) {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + 60 * 60 * 24 * 30;
    const key = new TextEncoder().encode(secret);
    return await new SignJWT({ email, access: "premium", plan })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuedAt(now)
        .setExpirationTime(exp)
        .sign(key);
}

function buildWelcomeEmail({ planLabel, authUrl, extensionUrl }) {
    const text = `Welcome to ${planLabel}!

Your payment is confirmed and your account is ready.

Open Linky Scout: ${authUrl}
Install the Chrome Extension: ${extensionUrl}

If you have any questions, reply to this email.

— The Linky team`;

    const html = `
<div style="font-family: Inter, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111827;">
    <h1 style="font-size: 22px; margin: 0 0 8px;">Welcome to ${planLabel}!</h1>
    <p style="color: #4b5563; line-height: 1.55; margin: 0 0 20px;">
        Your payment is confirmed and your account is ready. Use the buttons below to get started.
    </p>
    <div style="display: flex; flex-direction: column; gap: 12px; margin: 24px 0;">
        <a href="${authUrl}"
           style="display: inline-block; background: #8b5cf6; color: #fff; text-decoration: none; font-weight: 700; padding: 12px 18px; border-radius: 10px; text-align: center;">
            Open Linky Scout
        </a>
        <a href="${extensionUrl}"
           style="display: inline-block; background: #fff; color: #8b5cf6; border: 1px solid #c4b5fd; text-decoration: none; font-weight: 700; padding: 12px 18px; border-radius: 10px; text-align: center;">
            Install Chrome Extension
        </a>
    </div>
    <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
        This access link is valid for 30 days. If it expires, just sign in with your email at ${SCOUT_APP_URL}.
    </p>
</div>`;

    return { text, html };
}

async function handleSubscriptionCheckout({
    session,
    supabase,
    stripe,
    resend,
    jwtSecret,
    emailFrom
}) {
    const email = (session.customer_email || session.customer_details?.email || "").toLowerCase().trim();
    if (!email) {
        console.error("stripe-webhook: subscription checkout without email", session.id);
        return;
    }

    const subscriptionId = session.subscription;
    if (!subscriptionId) {
        console.error("stripe-webhook: checkout.session.completed without subscription id", session.id);
        return;
    }

    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const priceId = priceFromSubscription(subscription);
    const planInfo = PRICE_CATALOG[priceId];

    if (!planInfo || planInfo.type !== "subscription") {
        console.error("stripe-webhook: unknown subscription price", priceId);
        return;
    }

    const periodEndSec = subscription.current_period_end
        || subscription.items?.data?.[0]?.current_period_end;
    const currentPeriodEnd = periodEndSec ? new Date(periodEndSec * 1000).toISOString() : null;

    const { error: subUpsertError } = await supabase
        .from("user_subscriptions")
        .upsert(
            {
                email,
                plan: planInfo.plan,
                status: "active",
                stripe_customer_id: session.customer || subscription.customer,
                stripe_subscription_id: subscription.id,
                current_period_end: currentPeriodEnd,
                cancel_at_period_end: subscription.cancel_at_period_end || false,
                updated_at: new Date().toISOString()
            },
            { onConflict: "email" }
        );

    if (subUpsertError) {
        console.error("stripe-webhook: failed to upsert user_subscriptions", subUpsertError);
        throw subUpsertError;
    }

    const { error: creditsUpsertError } = await supabase
        .from("user_credits")
        .upsert(
            {
                email,
                subscription_credits: planInfo.sub_credits,
                pack_credits: 0,
                credits_period_end: currentPeriodEnd,
                messages_used: 0,
                messages_limit: planInfo.msg_limit,
                messages_period_end: currentPeriodEnd,
                updated_at: new Date().toISOString()
            },
            { onConflict: "email" }
        );

    if (creditsUpsertError) {
        console.error("stripe-webhook: failed to upsert user_credits", creditsUpsertError);
        throw creditsUpsertError;
    }

    const { error: txError } = await supabase
        .from("credit_transactions")
        .insert({
            email,
            amount: planInfo.sub_credits,
            type: "subscription_grant",
            reference_id: subscription.id,
            description: `Granted ${planInfo.sub_credits} credits for ${planInfo.plan} subscription`
        });

    if (txError) {
        console.error("stripe-webhook: failed to insert credit_transactions", txError);
    }

    const token = await signAuthToken({ email, plan: planInfo.plan, secret: jwtSecret });
    const authUrl = `${SCOUT_APP_URL}/auth?token=${encodeURIComponent(token)}`;
    const { text, html } = buildWelcomeEmail({
        planLabel: PLAN_LABELS[planInfo.plan] || "Linky",
        authUrl,
        extensionUrl: CHROME_EXTENSION_URL
    });

    const { error: mailError } = await resend.emails.send({
        from: emailFrom,
        to: [email],
        subject: `Welcome to ${PLAN_LABELS[planInfo.plan] || "Linky"} — your access is ready`,
        text,
        html
    });

    if (mailError) {
        console.error("stripe-webhook: resend send failed", mailError);
    }
}

async function handlePackCheckout({ session, supabase }) {
    const email = (
        session.metadata?.email
        || session.customer_email
        || session.customer_details?.email
        || ""
    ).toLowerCase().trim();

    if (!email) {
        console.error("stripe-webhook: pack checkout without email", session.id);
        return;
    }

    const priceId = session.metadata?.priceId
        || session.line_items?.data?.[0]?.price?.id
        || null;

    const packCreditsFromMeta = Number(session.metadata?.pack_credits);
    const packCredits = Number.isFinite(packCreditsFromMeta) && packCreditsFromMeta > 0
        ? packCreditsFromMeta
        : (priceId && PRICE_CATALOG[priceId]?.pack_credits) || 0;

    if (!packCredits) {
        console.error("stripe-webhook: pack checkout with unknown credits", session.id);
        return;
    }

    const { data: existing, error: readError } = await supabase
        .from("user_credits")
        .select("pack_credits")
        .eq("email", email)
        .maybeSingle();

    if (readError) {
        console.error("stripe-webhook: read user_credits failed", readError);
        throw readError;
    }

    const newPackTotal = (existing?.pack_credits || 0) + packCredits;

    const { error: upsertError } = await supabase
        .from("user_credits")
        .upsert(
            {
                email,
                pack_credits: newPackTotal,
                updated_at: new Date().toISOString()
            },
            { onConflict: "email" }
        );

    if (upsertError) {
        console.error("stripe-webhook: upsert user_credits failed", upsertError);
        throw upsertError;
    }

    const { error: txError } = await supabase
        .from("credit_transactions")
        .insert({
            email,
            amount: packCredits,
            type: "pack_purchase",
            reference_id: session.id,
            description: `Purchased ${packCredits} credits pack`
        });

    if (txError) {
        console.error("stripe-webhook: insert credit_transactions failed", txError);
    }
}

async function handleSubscriptionUpdated({ subscription, supabase }) {
    const priceId = priceFromSubscription(subscription);
    const planInfo = PRICE_CATALOG[priceId];

    const periodEndSec = subscription.current_period_end
        || subscription.items?.data?.[0]?.current_period_end;
    const newPeriodEnd = periodEndSec ? new Date(periodEndSec * 1000).toISOString() : null;

    const { data: existing, error: readError } = await supabase
        .from("user_subscriptions")
        .select("email, current_period_end, plan")
        .eq("stripe_subscription_id", subscription.id)
        .maybeSingle();

    if (readError) {
        console.error("stripe-webhook: read user_subscriptions failed", readError);
        throw readError;
    }

    if (!existing) {
        console.error("stripe-webhook: subscription.updated for unknown sub", subscription.id);
        return;
    }

    const { error: updateError } = await supabase
        .from("user_subscriptions")
        .update({
            status: subscription.status,
            current_period_end: newPeriodEnd,
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            updated_at: new Date().toISOString()
        })
        .eq("stripe_subscription_id", subscription.id);

    if (updateError) {
        console.error("stripe-webhook: update user_subscriptions failed", updateError);
        throw updateError;
    }

    const oldEnd = existing.current_period_end ? new Date(existing.current_period_end).getTime() : 0;
    const newEnd = newPeriodEnd ? new Date(newPeriodEnd).getTime() : 0;
    const renewed = newEnd > oldEnd
        && subscription.status === "active"
        && planInfo
        && planInfo.type === "subscription";

    if (!renewed) return;

    const { error: creditsResetError } = await supabase
        .from("user_credits")
        .update({
            subscription_credits: planInfo.sub_credits,
            credits_period_end: newPeriodEnd,
            messages_used: 0,
            messages_limit: planInfo.msg_limit,
            messages_period_end: newPeriodEnd,
            updated_at: new Date().toISOString()
        })
        .eq("email", existing.email);

    if (creditsResetError) {
        console.error("stripe-webhook: reset user_credits failed", creditsResetError);
        throw creditsResetError;
    }

    const { error: grantTxError } = await supabase
        .from("credit_transactions")
        .insert({
            email: existing.email,
            amount: planInfo.sub_credits,
            type: "subscription_grant",
            reference_id: subscription.id,
            description: `Renewed: granted ${planInfo.sub_credits} credits for ${planInfo.plan}`
        });

    if (grantTxError) {
        console.error("stripe-webhook: insert subscription_grant failed", grantTxError);
    }

    const { error: resetTxError } = await supabase
        .from("credit_transactions")
        .insert({
            email: existing.email,
            amount: planInfo.msg_limit,
            type: "messages_reset",
            reference_id: subscription.id,
            description: `Renewed: messages reset to ${planInfo.msg_limit}`
        });

    if (resetTxError) {
        console.error("stripe-webhook: insert messages_reset failed", resetTxError);
    }
}

async function handleSubscriptionDeleted({ subscription, supabase }) {
    const { error } = await supabase
        .from("user_subscriptions")
        .update({
            status: "canceled",
            cancel_at_period_end: subscription.cancel_at_period_end || false,
            updated_at: new Date().toISOString()
        })
        .eq("stripe_subscription_id", subscription.id);

    if (error) {
        console.error("stripe-webhook: cancel update failed", error);
        throw error;
    }
}

async function handleInvoicePaymentFailed({ invoice, supabase }) {
    const subscriptionId = invoice.subscription;
    if (!subscriptionId) return;

    const { error } = await supabase
        .from("user_subscriptions")
        .update({
            status: "past_due",
            updated_at: new Date().toISOString()
        })
        .eq("stripe_subscription_id", subscriptionId);

    if (error) {
        console.error("stripe-webhook: past_due update failed", error);
        throw error;
    }
}

export default async function handler(req, res) {
    if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature");
        return res.status(204).end();
    }

    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendApiKey = process.env.RESEND_API_KEY;
    const jwtSecret = process.env.AUTH_JWT_SECRET;
    const emailFrom = process.env.EMAIL_FROM || "Linky <noreply@linkyassistant.com>";

    if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !supabaseServiceRoleKey || !resendApiKey || !jwtSecret) {
        console.error("stripe-webhook: missing env vars");
        return res.status(500).json({ error: "Server misconfiguration" });
    }

    const stripe = new Stripe(stripeSecretKey);
    let rawBody;
    let event;

    try {
        rawBody = await readRawBody(req);
        const signature = req.headers["stripe-signature"];
        event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
        console.error("stripe-webhook: signature verification failed", err);
        return res.status(400).json({ error: `Webhook Error: ${err.message}` });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const resend = new Resend(resendApiKey);

    try {
        switch (event.type) {
            case "checkout.session.completed": {
                const session = event.data.object;
                const metaType = session.metadata?.type;

                if (metaType === "subscription" || session.mode === "subscription") {
                    await handleSubscriptionCheckout({
                        session,
                        supabase,
                        stripe,
                        resend,
                        jwtSecret,
                        emailFrom
                    });
                } else if (metaType === "pack" || session.mode === "payment") {
                    await handlePackCheckout({ session, supabase });
                } else {
                    console.error("stripe-webhook: unknown checkout type", session.id, metaType, session.mode);
                }
                break;
            }
            case "customer.subscription.updated": {
                await handleSubscriptionUpdated({ subscription: event.data.object, supabase });
                break;
            }
            case "customer.subscription.deleted": {
                await handleSubscriptionDeleted({ subscription: event.data.object, supabase });
                break;
            }
            case "invoice.payment_failed": {
                await handleInvoicePaymentFailed({ invoice: event.data.object, supabase });
                break;
            }
            default:
                break;
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error("stripe-webhook: handler error", event.type, err);
        return res.status(500).json({ error: "Webhook handler failed" });
    }
}
