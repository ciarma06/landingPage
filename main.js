(function () {
    const footerYear = document.getElementById("footer-year");
    if (footerYear) footerYear.textContent = String(new Date().getFullYear());

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

    const supabaseUrl = window.SUPABASE_URL;
    const supabaseAnonKey = window.SUPABASE_ANON_KEY;

    let supabaseClient = null;
    if (window.supabase && supabaseUrl && supabaseAnonKey && !supabaseUrl.includes("YOUR_SUPABASE_URL")) {
        supabaseClient = window.supabase.createClient(supabaseUrl, supabaseAnonKey);
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

        if (!supabaseClient) {
            statusMessage.textContent = "Supabase non configurato. Imposta URL e ANON KEY in index.html.";
            return;
        }

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton) submitButton.disabled = true;

        const email = emailInput.value.trim().toLowerCase();
        const source = new URLSearchParams(window.location.search).get("utm_source") ?? "direct";

        const { error } = await supabaseClient
            .from("utenti_waitlist")
            .insert([{ email, source }]);

        if (submitButton) submitButton.disabled = false;

        if (error) {
            if (error.code === "23505") {
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
