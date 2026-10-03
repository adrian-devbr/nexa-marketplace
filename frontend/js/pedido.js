(async function () {
    const session = await window.NEXASessionReady;
    const orderId = new URLSearchParams(window.location.search).get("id");
    const detail = document.querySelector("[data-order-detail]");
    const errorMessage = document.querySelector("[data-page-error]");
    const labels = {
        pending: "Pendente",
        accepted: "Aceito — aguardando pagamento",
        in_progress: "Em andamento",
        ready: "Disponível",
        completed: "Concluído",
        cancelled: "Cancelado",
        rejected: "Recusado"
    };
    let currentOrder;

    function showError(error) {
        console.error("Erro ao carregar pedido:", error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }

    async function load() {
        const { order } = await window.NEXAApi.request(`/orders/${encodeURIComponent(orderId)}`);
        currentOrder = order;
        document.querySelector("[data-order-title]").textContent = `Pedido #${order.orderNumber}`;
        const listing = document.querySelector("[data-order-listing]");
        listing.replaceChildren();
        const link = document.createElement("a");
        link.href = `/pages/produto.html?item=${encodeURIComponent(order.listingId)}`;
        link.textContent = order.listingTitle;
        listing.append(link);
        const facts = document.querySelector("[data-order-facts]");
        facts.replaceChildren();
        const entries = [
            ["Comprador", order.buyerName],
            ["Vendedor", order.sellerName],
            ["Quantidade", String(order.quantity)],
            ["Preço unitário", window.NEXAApi.formatPrice(order.unitPrice)],
            ["Total registrado no pedido", window.NEXAApi.formatPrice(order.total)],
            ["Criado em", new Date(order.createdAt).toLocaleString("pt-BR")],
            ["Pagamento", order.paymentStatus ?? "Ainda não iniciado"]
        ];
        entries.forEach(([label, value]) => {
            const wrapper = document.createElement("div");
            const term = document.createElement("dt");
            term.textContent = label;
            const description = document.createElement("dd");
            description.textContent = value;
            wrapper.append(term, description);
            facts.append(wrapper);
        });
        document.querySelector("[data-order-status]").textContent = labels[order.status] ?? order.status;
        detail.hidden = false;
        renderActions(order);
        const reviewForm = document.querySelector("[data-review-form]");
        reviewForm.hidden = order.status !== "completed" || Boolean(order.ownReviewId);
    }

    function addAction(container, label, action, style = "") {
        const button = document.createElement("button");
        button.type = "button";
        if (style) button.className = style;
        button.textContent = label;
        button.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await action();
                await load();
            } catch (error) {
                showError(error);
                button.disabled = false;
            }
        });
        container.append(button);
    }

    function renderActions(order) {
        const actions = document.querySelector("[data-order-actions]");
        actions.replaceChildren();
        const isBuyer = order.buyerId === session.id;
        const statusUpdate = (status) => window.NEXAApi.request(
            `/orders/${order.id}/status`,
            { method: "PATCH", body: { status } }
        );
        if (!isBuyer && order.status === "pending") {
            addAction(actions, "Aceitar pedido", () => statusUpdate("accepted"));
            addAction(actions, "Recusar pedido", () => statusUpdate("rejected"), "botao-secundario");
        } else if (!isBuyer && order.status === "in_progress") {
            addAction(actions, "Marcar como disponível", () => statusUpdate("ready"));
        } else if (isBuyer && (
            order.status === "pending" ||
            (order.status === "accepted" && order.paymentStatus !== "pending")
        )) {
            addAction(actions, "Cancelar pedido", () => statusUpdate("cancelled"), "botao-secundario");
        } else if (isBuyer && order.status === "ready") {
            addAction(actions, "Confirmar conclusão", () => statusUpdate("completed"));
        }
        if (isBuyer && order.status === "accepted" && order.paymentStatus !== "approved") {
            addAction(actions, order.paymentStatus === "pending" ? "Continuar pagamento" : "Pagar com Mercado Pago", async () => {
                const payment = await window.NEXAApi.request(`/payments/${order.id}`, {
                    method: "POST",
                    body: {}
                });
                if (!payment.checkoutUrl) throw new Error("O provedor não retornou o endereço de pagamento.");
                window.location.assign(payment.checkoutUrl);
            });
        }
        if (order.paymentStatus === "approved") {
            const paid = document.createElement("p");
            paid.className = "mensagem-pagina";
            paid.textContent = "Pagamento confirmado pelo provedor.";
            actions.append(paid);
        }
    }

    if (!session) {
        document.querySelector("[data-login-required]").hidden = false;
        return;
    }
    if (!orderId) {
        showError(new Error("Informe o pedido que deseja consultar."));
        return;
    }
    try {
        await load();
    } catch (error) {
        showError(error);
        return;
    }

    window.setInterval(async () => {
        if (!document.hidden && currentOrder?.paymentStatus === "pending") {
            try {
                await load();
            } catch (error) {
                showError(error);
            }
        }
    }, 10000);

    document.querySelector("[data-review-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const button = form.querySelector("button[type=submit]");
        button.disabled = true;
        try {
            await window.NEXAApi.request(`/orders/${currentOrder.id}/reviews`, {
                method: "POST",
                body: {
                    rating: Number(data.get("rating")),
                    comment: String(data.get("comment")).trim()
                }
            });
            await load();
        } catch (error) {
            showError(error);
        } finally {
            button.disabled = false;
        }
    });
})();
