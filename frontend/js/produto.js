(async function () {
    const params = new URLSearchParams(window.location.search);
    const itemId = params.get("item");
    let item = null;
    const mensagemErro = document.querySelector("#erro-produto");

    if (itemId) {
        try {
            ({ listing: item } = await window.NEXAApi.request(`/listings/${encodeURIComponent(itemId)}`));
        } catch (error) {
            console.error("Erro ao carregar anúncio:", error);
            mensagemErro.textContent = error.message;
            mensagemErro.hidden = false;
        }
    }
    if (!itemId) item = null;

    if (!item) {
        document.title = "Anúncio não encontrado | NEXA";
        document.querySelector("#produto-nome").textContent = "Anúncio não encontrado";
        document.querySelector("#produto-descricao").textContent =
            "Este anúncio não existe ou não está mais disponível.";
        ["#produto-tipo", "#produto-categoria", "#produto-avaliacao", "#produto-preco",
            "#produto-anunciante", "#produto-icone", "#favorito-detalhe",
            "[data-marketplace-actions]", ".reviews-section"]
            .forEach((selector) => {
                const element = document.querySelector(selector);
                if (element) element.hidden = true;
            });
        return;
    }

    const name = item.name ?? item.title;
    const image = document.querySelector("#produto-imagem");
    document.title = `${name} | NEXA`;
    document.querySelector("#produto-nome").textContent = name;
    document.querySelector("#produto-tipo").textContent = item.type === "servico" ? "Serviço" : "Produto";
    document.querySelector("#produto-descricao").textContent = item.description;
    document.querySelector("#produto-categoria").textContent = `Categoria: ${item.category}`;
    document.querySelector("#produto-preco").textContent =
        `Preço: ${window.NEXAApi.formatPrice(item.price)}`;
    if (item.ownerId) {
        const sellerLink = document.createElement("a");
        sellerLink.href = `/pages/perfil.html?user=${encodeURIComponent(item.ownerId)}`;
        sellerLink.textContent = `Anunciado por: ${item.ownerName ?? "NEXA"}`;
        document.querySelector("#produto-anunciante").replaceChildren(sellerLink);
    } else {
        document.querySelector("#produto-anunciante").textContent =
            `Anunciado por: ${item.ownerName ?? "NEXA"}`;
    }

    const rating = document.querySelector("#produto-avaliacao");
    if (Number(item.rating) > 0) {
        rating.textContent = `⭐ ${Number(item.rating).toLocaleString("pt-BR")} · ${item.reviewCount ?? 0} avaliações`;
    } else {
        rating.hidden = true;
    }
    if (item.image) {
        image.src = item.image;
        image.alt = `Imagem de ${name}`;
        image.hidden = false;
        document.querySelector("#produto-icone").hidden = true;
    } else {
        document.querySelector("#produto-icone").textContent =
            item.type === "servico" ? "🛠️" : "📦";
    }

    const session = item.ownerId ? await window.NEXASessionReady : null;
    const favorite = document.querySelector("#favorito-detalhe");
    favorite.dataset.favoriteId = itemId;
    favorite.hidden = false;
    window.NEXAFavorites.initializeButton(favorite);
    favorite.addEventListener("click", () => {
        try {
            window.NEXAFavorites.updateButton(favorite, window.NEXAFavorites.toggle(itemId));
        } catch (error) {
            console.error("Erro ao salvar anúncio:", error);
            mensagemErro.textContent = error.message;
            mensagemErro.hidden = false;
        }
    });

    if (item.ownerId) {
        if (!session) {
            document.querySelector("[data-marketplace-message]").textContent =
                "Entre na sua conta para conversar ou fazer um pedido.";
            document.querySelector("[data-marketplace-message]").hidden = false;
        } else if (session.id !== item.ownerId && session.userId !== item.ownerId) {
            const actions = document.querySelector("[data-marketplace-actions]");
            actions.hidden = false;
            actions.querySelector("[data-message-seller]").addEventListener("click", async (event) => {
                const button = event.currentTarget;
                button.disabled = true;
                try {
                    const conversation = await window.NEXAApi.request("/conversations", {
                        method: "POST",
                        body: { listingId: item.id }
                    });
                    window.location.assign(`/pages/mensagens.html?conversation=${conversation.id}`);
                } catch (error) {
                    mensagemErro.textContent = error.message;
                    mensagemErro.hidden = false;
                    button.disabled = false;
                }
            });
            actions.querySelector("[data-order-form]").addEventListener("submit", async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const button = form.querySelector('button[type="submit"]');
                button.disabled = true;
                try {
                    const quantity = Number(new FormData(form).get("quantity"));
                    const { order } = await window.NEXAApi.request("/orders", {
                        method: "POST",
                        body: { listingId: item.id, quantity }
                    });
                    window.location.assign(`/pages/pedido.html?id=${order.id}`);
                } catch (error) {
                    mensagemErro.textContent = error.message;
                    mensagemErro.hidden = false;
                    button.disabled = false;
                }
            });
        }
    }

    if (item.ownerId) {
        try {
            const { reviews } = await window.NEXAApi.request(
                `/listings/${encodeURIComponent(item.id)}/reviews`
            );
            const container = document.querySelector("[data-listing-reviews]");
            if (!reviews.length) {
                const empty = document.createElement("p");
                empty.textContent = "Ainda não há avaliações para este vendedor.";
                container.append(empty);
            }
            reviews.forEach((review) => {
                const card = document.createElement("article");
                card.className = "review-card";
                const heading = document.createElement("h3");
                heading.textContent = `${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)} · ${review.reviewerName}`;
                const comment = document.createElement("p");
                comment.textContent = review.comment || "Sem comentário.";
                const date = document.createElement("time");
                date.dateTime = review.createdAt;
                date.textContent = new Date(review.createdAt).toLocaleDateString("pt-BR");
                card.append(heading, comment, date);
                if (session) {
                    const report = document.createElement("button");
                    report.type = "button";
                    report.className = "botao-secundario";
                    report.textContent = "Denunciar avaliação";
                    report.addEventListener("click", async () => {
                        report.disabled = true;
                        try {
                            await window.NEXAApi.request(`/orders/reviews/${review.id}/report`, {
                                method: "POST",
                                body: {}
                            });
                            report.textContent = "Denúncia enviada";
                        } catch (error) {
                            console.error("Erro ao denunciar avaliação:", error);
                            mensagemErro.textContent = error.message;
                            mensagemErro.hidden = false;
                            report.disabled = false;
                        }
                    });
                    card.append(report);
                }
                container.append(card);
            });
        } catch (error) {
            console.error("Erro ao carregar avaliações:", error);
        }
    } else {
        document.querySelector(".reviews-section").hidden = true;
    }
})();
