(async function () {
    const session = await window.NEXASessionReady;
    const content = document.querySelector("[data-profile-content]");
    const loginMessage = document.querySelector("[data-login-required]");
    const errorMessage = document.querySelector("[data-profile-error]");
    const requestedId = new URLSearchParams(window.location.search).get("user");
    const userId = requestedId || session?.id;
    const ownProfile = Boolean(session && session.id === userId);

    function showError(error) {
        console.error("Erro ao carregar perfil:", error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }
    function textElement(tag, text, className) {
        const element = document.createElement(tag);
        element.textContent = text;
        if (className) element.className = className;
        return element;
    }

    if (!userId) {
        loginMessage.hidden = false;
        return;
    }
    try {
        const { user, listings, reviews } = await window.NEXAApi.request(
            `/users/${encodeURIComponent(userId)}`
        );
        content.hidden = false;
        document.title = `${user.name} | NEXA`;
        document.querySelector("#titulo-perfil").textContent =
            ownProfile ? "Meu perfil" : `Perfil de ${user.name}`;
        document.querySelector("[data-profile-name]").textContent = user.name;
        document.querySelector("[data-profile-rating]").textContent =
            user.reviewCount > 0
                ? `⭐ ${Number(user.rating).toLocaleString("pt-BR")} de 5 · ${user.reviewCount} avaliações`
                : "Ainda sem avaliações";
        document.querySelector("[data-profile-member-since]").textContent =
            `No NEXA desde ${new Date(user.createdAt).toLocaleDateString("pt-BR")}`;
        document.querySelector("[data-profile-listing-count]").textContent =
            String(listings.length);
        document.querySelector("[data-private-email]").hidden = !ownProfile;
        document.querySelector("[data-own-profile]").hidden = !ownProfile;
        if (ownProfile) {
            document.querySelector("[data-profile-email]").textContent = session.email;
            document.querySelector("[data-profile-form]").elements.name.value = user.name;
        } else {
            document.querySelector(".aviso-prototipo")?.remove();
            document.querySelector("[data-profile-form]").hidden = true;
        }

        const listingContainer = document.querySelector("[data-profile-listings]");
        if (!listings.length) {
            listingContainer.append(textElement("p", "Nenhum anúncio publicado."));
        }
        listings.forEach((listing) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const link = document.createElement("a");
            link.href = `/pages/produto.html?item=${encodeURIComponent(listing.id)}`;
            link.textContent = listing.title;
            const price = textElement("p", window.NEXAApi.formatPrice(listing.price));
            card.append(link, price);
            listingContainer.append(card);
        });

        const reviewsContainer = document.querySelector("[data-profile-reviews]");
        if (!reviews.length) {
            reviewsContainer.append(textElement("p", "Ainda não há avaliações."));
        }
        reviews.forEach((review) => {
            const card = document.createElement("article");
            card.className = "review-card";
            card.append(
                textElement("h3", `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)} · ${review.reviewerName}`),
                textElement("p", review.comment || "Sem comentário."),
                textElement("time", new Date(review.createdAt).toLocaleDateString("pt-BR"))
            );
            reviewsContainer.append(card);
        });
    } catch (error) {
        showError(error);
        return;
    }

    document.querySelector("[data-profile-form]")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = String(new FormData(form).get("name")).trim();
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        try {
            const { user } = await window.NEXAApi.request("/auth/me", {
                method: "GET"
            });
            const result = await window.NEXAApi.request("/auth/me", {
                method: "PATCH",
                body: { name }
            });
            window.NEXAStore.session.set({ ...user, ...result.user });
            document.querySelector("[data-profile-name]").textContent = result.user.name;
            document.querySelector("[data-profile-email]").textContent = result.user.email;
            const message = document.querySelector("[data-profile-message]");
            message.textContent = "Seu perfil foi atualizado.";
            message.classList.remove("mensagem-erro");
            message.hidden = false;
        } catch (error) {
            showError(error);
        } finally {
            button.disabled = false;
        }
    });
})();
