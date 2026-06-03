(function () {
    const OWNED_PLANS_KEY = "linky_owned_plans";
    const PENDING_PLAN_KEY = "linky_pending_plan";

    function getOwnedPlans() {
        try {
            const raw = localStorage.getItem(OWNED_PLANS_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function markButtonOwned(btn) {
        btn.disabled = true;
        btn.classList.add("is-owned");
        btn.classList.remove("is-loading");
        btn.textContent = "Already purchased";
    }

    function resetAllLoadingButtons() {
        document.querySelectorAll("[data-price-id]").forEach(function (btn) {
            if (btn.classList.contains("is-owned")) return;
            if (btn.dataset.originalText) {
                btn.textContent = btn.dataset.originalText;
                btn.disabled = false;
                btn.classList.remove("is-loading");
            }
        });
        try {
            sessionStorage.removeItem(PENDING_PLAN_KEY);
        } catch {
            // Ignore storage errors
        }
    }

    const PROMO_END = new Date("2026-07-02T23:59:59Z");
    const promoActive = new Date() < PROMO_END;

    document.querySelectorAll(".js-promo-ui").forEach(function (el) {
        el.hidden = !promoActive;
    });
    document.querySelectorAll(".js-full-price-ui").forEach(function (el) {
        el.hidden = promoActive;
    });

    const owned = getOwnedPlans();
    document.querySelectorAll("[data-price-id][data-plan]").forEach(function (btn) {
        if (owned.includes(btn.dataset.plan)) {
            markButtonOwned(btn);
        }
    });

    function resetTrialSubmitButton() {
        const trialForm = document.getElementById("trial-form");
        if (!trialForm) return;
        const submitButton = trialForm.querySelector('button[type="submit"]');
        if (!submitButton) return;
        if (submitButton.dataset.originalText) {
            submitButton.textContent = submitButton.dataset.originalText;
        }
        submitButton.disabled = false;
        submitButton.classList.remove("is-loading");
    }

    window.addEventListener("pageshow", function (e) {
        if (e.persisted) {
            resetAllLoadingButtons();
            resetTrialSubmitButton();
        }
    });

    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            resetAllLoadingButtons();
            resetTrialSubmitButton();
        }
    });

    const footerYear = document.getElementById("footer-year");
    if (footerYear) footerYear.textContent = String(new Date().getFullYear());

    const THEME_STORAGE_KEY = "linky-theme";
    const root = document.documentElement;

    function readStoredTheme() {
        try {
            return localStorage.getItem(THEME_STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function writeStoredTheme(value) {
        try {
            localStorage.setItem(THEME_STORAGE_KEY, value);
        } catch (e) {
            // Ignore storage errors (private mode, quota, etc.)
        }
    }

    function applyTheme(theme) {
        if (theme === "dark") {
            root.classList.add("dark");
        } else {
            root.classList.remove("dark");
        }
    }

    const storedTheme = readStoredTheme();
    if (storedTheme === "dark" || storedTheme === "light") {
        applyTheme(storedTheme);
    }

    const themeToggle = document.getElementById("theme-toggle");
    if (themeToggle) {
        themeToggle.addEventListener("click", function () {
            const nextTheme = root.classList.contains("dark") ? "light" : "dark";
            applyTheme(nextTheme);
            writeStoredTheme(nextTheme);
        });
    }

    const identityVideo = document.querySelector(".identity-feature__video");
    if (identityVideo) {
        const setDoubleSpeed = function () {
            identityVideo.playbackRate = 2;
        };

        setDoubleSpeed();
        identityVideo.addEventListener("loadedmetadata", setDoubleSpeed);
        identityVideo.play().catch(function () {
            // Ignore autoplay rejections from restrictive browser policies.
        });
    }

    const checkoutPopup = document.getElementById("checkout-popup");
    function openCheckoutPopup() {
        if (!checkoutPopup) return;
        checkoutPopup.hidden = false;
        document.body.classList.add("no-scroll");
    }
    function closeCheckoutPopup() {
        if (!checkoutPopup) return;
        checkoutPopup.hidden = true;
        document.body.classList.remove("no-scroll");
    }
    if (checkoutPopup) {
        const closeBtn = checkoutPopup.querySelector(".checkout-popup__close");
        if (closeBtn) closeBtn.addEventListener("click", closeCheckoutPopup);
        checkoutPopup.addEventListener("click", function (e) {
            if (e.target === checkoutPopup) closeCheckoutPopup();
        });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && !checkoutPopup.hidden) closeCheckoutPopup();
        });
    }
    window.openCheckoutPopup = openCheckoutPopup;
    window.closeCheckoutPopup = closeCheckoutPopup;

    document.querySelectorAll(".js-checkout").forEach(function (btn) {
        if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
        btn.addEventListener("click", async function (e) {
            e.preventDefault();
            if (btn.classList.contains("is-owned")) return;

            const plan = btn.dataset.plan;
            if (plan) {
                try {
                    sessionStorage.setItem(PENDING_PLAN_KEY, plan);
                } catch {
                    // Ignore storage errors
                }
            }

            if (!btn.dataset.originalText) {
                btn.dataset.originalText = btn.textContent;
            }
            btn.classList.add("is-loading");
            btn.textContent = "Loading...";
            btn.disabled = true;

            try {
                const res = await fetch("/api/create-checkout", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ priceId: btn.dataset.priceId })
                });
                const data = await res.json().catch(function () { return {}; });
                if (!res.ok || data.error) throw new Error(data.error || "Checkout failed");
                if (!data.url) throw new Error("Missing checkout URL");
                window.location.href = data.url;
            } catch (err) {
                console.error("checkout error:", err);
                alert("Error: " + err.message);
                try {
                    sessionStorage.removeItem(PENDING_PLAN_KEY);
                } catch {
                    // Ignore storage errors
                }
                btn.textContent = btn.dataset.originalText || "Get plan";
                btn.disabled = false;
                btn.classList.remove("is-loading");
            }
        });
    });

    document.querySelectorAll(".js-checkout-pack").forEach(function (btn) {
        if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            alert("Login on Scout to buy packs");
        });
    });

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trialForm = document.getElementById("trial-form");
    const trialError = document.getElementById("trial-form-error");

    if (trialForm) {
        const emailInput = trialForm.querySelector("#email");
        const submitButton = trialForm.querySelector('button[type="submit"]');

        if (submitButton && !submitButton.dataset.originalText) {
            submitButton.dataset.originalText = submitButton.textContent;
        }

        const trialLinks = document.querySelectorAll('.js-focus-trial[href="#trial-form"]');
        if (trialLinks.length && emailInput) {
            trialLinks.forEach(function (link) {
                link.addEventListener("click", function (e) {
                    e.preventDefault();
                    trialForm.scrollIntoView({ behavior: "smooth", block: "center" });
                    emailInput.focus();
                    emailInput.select();
                });
            });
        }

        function showTrialError(message) {
            if (!trialError) return;
            trialError.textContent = message;
            trialError.hidden = !message;
        }

        trialForm.addEventListener("submit", async function (e) {
            e.preventDefault();
            showTrialError("");

            const email = emailInput ? emailInput.value.trim().toLowerCase() : "";
            if (!EMAIL_REGEX.test(email)) {
                if (emailInput) emailInput.reportValidity();
                return;
            }

            if (submitButton) {
                submitButton.disabled = true;
                submitButton.classList.add("is-loading");
                submitButton.textContent = "Starting...";
            }

            let response;
            try {
                response = await fetch("/api/register", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email })
                });
            } catch {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.classList.remove("is-loading");
                    submitButton.textContent = submitButton.dataset.originalText || "Start free trial";
                }
                showTrialError("Something went wrong. Please try again.");
                return;
            }

            const data = await response.json().catch(function () {
                return {};
            });

            if (!response.ok || !data.ok || !data.redirect) {
                if (submitButton) {
                    submitButton.disabled = false;
                    submitButton.classList.remove("is-loading");
                    submitButton.textContent = submitButton.dataset.originalText || "Start free trial";
                }
                showTrialError("Something went wrong. Please try again.");
                return;
            }

            window.location.href = data.redirect;
        });
    }
})();
