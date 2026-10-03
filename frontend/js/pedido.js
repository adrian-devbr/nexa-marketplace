(async function () {
    const session = await window.NEXASessionReady;
    const orderId = new URLSearchParams(window.location.search).get("id");
    const detail = document.querySelector("[data-order-detail]");
    const errorMessage = document.querySelector("[data-page-error]");
    const labels = {
        pending: "Aguardando vendedor",
        accepted: "Aceito — aguardando pagamento",
        paid: "Pago — aguardando início do vendedor",
        in_progress: "Em andamento",
        ready: "Disponível",
        completed: "Concluído",
        cancelled: "Cancelado",
        rejected: "Recusado"
    };
    const historyLabels = {
        pending: "Aguardando vendedor",
        accepted: "Aceito pelo vendedor",
        awaiting_payment: "Aguardando pagamento",
        paid: "Pagamento confirmado",
        payment_pending: "Pagamento pendente",
        payment_approved: "Pagamento confirmado — pedido exige análise",
        payment_rejected: "Pagamento recusado",
        payment_cancelled: "Pagamento cancelado",
        payment_refunded: "Pagamento estornado",
        in_progress: "Em andamento",
        ready: "Disponível",
        completed: "Concluído",
        cancelled: "Cancelado",
        rejected: "Recusado"
    };
    const paymentLabels = {
        pending: "Aguardando confirmação do Mercado Pago",
        approved: "Confirmado pelo Mercado Pago",
        rejected: "Recusado pelo Mercado Pago",
        cancelled: "Cancelado pelo Mercado Pago",
        refunded: "Estornado pelo Mercado Pago"
    };
    let currentOrder;

    function showError(error) {
        console.error("Erro ao carregar pedido:", error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }

    async function load() {
        errorMessage.hidden = true;
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
            ["Preço anunciado / total do comprador", window.NEXAApi.formatPrice(order.total)],
            [`Taxa NEXA (${Number(order.platformFeeRate).toLocaleString("pt-BR")}%)`,
                window.NEXAApi.formatPrice(order.platformFee)],
            ["Tarifa do Mercado Pago", order.providerFee === null
                ? order.paymentStatus === "approved"
                    ? "Não informada pelo provedor"
                    : order.paymentStatus === "pending"
                        ? "Aguardando confirmação do Mercado Pago"
                        : "Informada pelo provedor após a transação"
                : window.NEXAApi.formatPrice(order.providerFee)],
            ["Líquido estimado do vendedor", order.sellerNet === null
                ? order.paymentStatus === "approved"
                    ? "Não calculável: tarifa não informada pelo provedor"
                    : `${window.NEXAApi.formatPrice(order.total - order.platformFee)} antes da tarifa do Mercado Pago`
                : window.NEXAApi.formatPrice(order.sellerNet)],
            ["Criado em", new Date(order.createdAt).toLocaleString("pt-BR")],
            ["Pagamento", paymentLabels[order.paymentStatus] ?? "Ainda não iniciado"]
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
        const { history } = await window.NEXAApi.request(`/orders/${encodeURIComponent(order.id)}/history`);
        const historyList = document.querySelector("[data-order-history]");
        historyList.replaceChildren();
        history.forEach((entry) => {
            const item = document.createElement("li");
            const title = document.createElement("strong");
            title.textContent = historyLabels[entry.status] ?? entry.status;
            const detail = document.createElement("p");
            detail.textContent = entry.details;
            const date = document.createElement("time");
            date.dateTime = entry.createdAt;
            date.textContent = new Date(entry.createdAt).toLocaleString("pt-BR");
            item.append(title, detail, date);
            historyList.append(item);
        });
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
        if (!isBuyer && order.status === "paid") {
            addAction(actions, "Iniciar entrega / serviço", () => statusUpdate("in_progress"));
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
        if (!document.hidden &&
            !["completed", "cancelled", "rejected"].includes(currentOrder?.status)) {
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
