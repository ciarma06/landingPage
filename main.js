(function () {
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

    const form = document.getElementById("waitlist-form");
    const success = document.getElementById("form-success");

    if (!form || !success) return;
    const emailInput = form.querySelector("#email");

    const waitlistLinks = document.querySelectorAll('.js-focus-waitlist[href="#waitlist-form"]');
    if (waitlistLinks.length && emailInput) {
        waitlistLinks.forEach(function (link) {
            link.addEventListener("click", function (e) {
                e.preventDefault();
                form.scrollIntoView({ behavior: "smooth", block: "center" });
                emailInput.focus();
                emailInput.select();
            });
        });
    }

    const statusMessage = document.createElement("p");
    statusMessage.setAttribute("role", "status");
    statusMessage.setAttribute("aria-live", "polite");
    statusMessage.style.marginTop = "12px";
    statusMessage.style.color = "#f87171";
    form.insertAdjacentElement("afterend", statusMessage);

    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        statusMessage.textContent = "";

        if (!emailInput || !emailInput.checkValidity()) {
            emailInput?.reportValidity();
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        const email = emailInput.value.trim().toLowerCase();
        const source = new URLSearchParams(window.location.search).get("utm_source") ?? "direct";

        let response;
        try {
            response = await fetch("/api/waitlist", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email, source })
            });
        } catch {
            if (submitButton) submitButton.disabled = false;
            statusMessage.textContent = "Errore di rete. Riprova tra poco.";
            return;
        }

        if (submitButton) submitButton.disabled = false;

        if (!response.ok) {
            const result = await response.json().catch(function () {
                return {};
            });

            if (result?.code === "23505") {
                statusMessage.textContent = "Sei gia in lista - ti avviseremo al lancio!";
            } else {
                statusMessage.textContent = "Errore nel salvataggio della mail. Riprova tra poco.";
            }
            return;
        }

        form.hidden = true;
        success.hidden = false;
    });
})();
