(async function () {
    const session = await window.NEXASessionReady;
    const list = document.querySelector("[data-orders]");
    const errors = document.querySelector("[data-page-error]");
    const labels = {
        pending: "Pendente",
        accepted: "Aceito — aguardando pagamento",
        in_progress: "Em andamento",
        ready: "Disponível",
        completed: "Concluído",
        cancelled: "Cancelado",
        rejected: "Recusado"
    };

    if (!session) {
        document.querySelector("[data-login-required]").hidden = false;
        return;
    }

    try {
        const { orders } = await window.NEXAApi.request("/orders");
        document.querySelector("[data-empty-orders]").hidden = orders.length > 0;
        orders.forEach((order) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = order.listingTitle;
            const number = document.createElement("p");
            number.textContent = `Pedido #${order.orderNumber}`;
            const detail = document.createElement("p");
            detail.textContent = `${order.isBuyer ? "Vendedor" : "Comprador"}: ${order.otherUserName} · ${order.quantity} un. · ${window.NEXAApi.formatPrice(order.total)}`;
            const status = document.createElement("span");
            status.className = "etiqueta";
            status.textContent = labels[order.status] ?? order.status;
            const link = document.createElement("a");
            link.className = "botao-link";
            link.href = `/pages/pedido.html?id=${encodeURIComponent(order.id)}`;
            link.textContent = "Ver pedido";
            card.append(title, number, detail, status, link);
            list.append(card);
        });
        const { payments } = await window.NEXAApi.request("/payments/history");
        const history = document.querySelector("[data-payment-history]");
        if (!payments.length) {
            const empty = document.createElement("p");
            empty.textContent = "Ainda não há pagamentos registrados.";
            history.append(empty);
        } else {
            payments.forEach((payment) => {
                const row = document.createElement("article");
                row.className = "pedido-card";
                const title = document.createElement("h3");
                title.textContent = payment.listingTitle;
                const description = document.createElement("p");
                description.textContent =
                    `${payment.direction === "purchase" ? "Compra" : "Venda"} · Pedido #${payment.orderNumber} · ${payment.paymentStatus} · ${window.NEXAApi.formatPrice(payment.amount)}`;
                const link = document.createElement("a");
                link.className = "botao-link";
                link.href = `/pages/pedido.html?id=${encodeURIComponent(payment.orderId)}`;
                link.textContent = "Ver pedido";
                row.append(title, description, link);
                history.append(row);
            });
        }
    } catch (error) {
        console.error("Erro ao carregar pedidos:", error);
        errors.textContent = error.message;
        errors.hidden = false;
    }
})();
