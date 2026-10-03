(async function () {
    const session = await window.NEXASessionReady;
    const list = document.querySelector("[data-moderation-list]");
    const errors = document.querySelector("[data-page-error]");

    if (!session || session.role !== "admin") {
        document.querySelector("[data-access-error]").textContent =
            "Esta página está disponível somente para moderadores.";
        document.querySelector("[data-access-error]").hidden = false;
        return;
    }

    async function load() {
        const { listings } = await window.NEXAApi.request("/admin/listings?status=pending");
        list.replaceChildren();
        document.querySelector("[data-empty-moderation]").hidden = listings.length > 0;
        listings.forEach((listing) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = listing.title;
            const details = document.createElement("p");
            details.textContent = `${listing.ownerName} · ${listing.ownerEmail} · ${window.NEXAApi.formatPrice(listing.price)}`;
            const description = document.createElement("p");
            description.textContent = listing.description;
            card.append(title, details, description);
            [["approve", "Aprovar"], ["reject", "Recusar"]].forEach(([decision, label]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                if (decision === "reject") button.className = "botao-secundario";
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    try {
                        await window.NEXAApi.request(`/admin/listings/${listing.id}`, {
                            method: "PATCH",
                            body: { decision }
                        });
                        await load();
                    } catch (error) {
                        errors.textContent = error.message;
                        errors.hidden = false;
                        button.disabled = false;
                    }
                });
                card.append(button);
            });
            list.append(card);
        });
        const { reviews } = await window.NEXAApi.request("/admin/reviews/reported");
        const reviewList = document.querySelector("[data-reported-reviews]");
        reviewList.replaceChildren();
        document.querySelector("[data-empty-reviews]").hidden = reviews.length > 0;
        reviews.forEach((review) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = `${review.rating}/5 · ${review.reviewerName} avaliou ${review.subjectName} (pedido #${review.orderNumber})`;
            const comment = document.createElement("p");
            comment.textContent = review.comment || "Sem comentário.";
            card.append(title, comment);
            [["dismiss", "Manter avaliação"], ["remove", "Remover avaliação"]]
                .forEach(([decision, label]) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = label;
                    if (decision === "remove") button.className = "botao-excluir";
                    button.addEventListener("click", async () => {
                        button.disabled = true;
                        try {
                            await window.NEXAApi.request(`/admin/reviews/${review.id}`, {
                                method: "PATCH",
                                body: { decision }
                            });
                            await load();
                        } catch (error) {
                            errors.textContent = error.message;
                            errors.hidden = false;
                            button.disabled = false;
                        }
                    });
                    card.append(button);
                });
            reviewList.append(card);
        });
    }

    try {
        await load();
    } catch (error) {
        console.error("Erro ao carregar a fila de moderação:", error);
        errors.textContent = error.message;
        errors.hidden = false;
    }
})();
