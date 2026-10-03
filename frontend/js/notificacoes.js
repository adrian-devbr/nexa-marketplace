(async function () {
    const session = await window.NEXASessionReady;
    const list = document.querySelector("[data-notifications]");
    const errorMessage = document.querySelector("[data-page-error]");

    async function load() {
        const { notifications } = await window.NEXAApi.request("/notifications");
        list.replaceChildren();
        document.querySelector("[data-empty-notifications]").hidden = notifications.length > 0;
        notifications.forEach((notification) => {
            const card = document.createElement("article");
            card.className = `notificacao${notification.readAt ? "" : " nao-lida"}`;
            const title = document.createElement("h2");
            title.textContent = notification.title;
            const body = document.createElement("p");
            body.textContent = notification.body;
            const date = document.createElement("time");
            date.dateTime = notification.createdAt;
            date.textContent = new Date(notification.createdAt).toLocaleString("pt-BR");
            card.append(title, body, date);
            if (notification.resourceId && notification.resourceType === "order") {
                const link = document.createElement("a");
                link.href = `/pages/pedido.html?id=${encodeURIComponent(notification.resourceId)}`;
                link.textContent = "Ver pedido";
                card.append(link);
            } else if (notification.resourceId && notification.resourceType === "conversation") {
                const link = document.createElement("a");
                link.href = `/pages/mensagens.html?conversation=${encodeURIComponent(notification.resourceId)}`;
                link.textContent = "Abrir conversa";
                card.append(link);
            } else if (notification.resourceId && notification.resourceType === "listing") {
                const link = document.createElement("a");
                link.href = notification.type === "listing_approved"
                    ? `/pages/produto.html?item=${encodeURIComponent(notification.resourceId)}`
                    : "/pages/painel.html";
                link.textContent = notification.type === "listing_approved"
                    ? "Ver anúncio"
                    : "Ver meus anúncios";
                card.append(link);
            }
            if (!notification.readAt) {
                const button = document.createElement("button");
                button.type = "button";
                button.className = "botao-secundario";
                button.textContent = "Marcar como lida";
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    try {
                        await window.NEXAApi.request(`/notifications/${notification.id}/read`, {
                            method: "PATCH",
                            body: {}
                        });
                        await load();
                    } catch (error) {
                        showError(error);
                        button.disabled = false;
                    }
                });
                card.append(button);
            }
            list.append(card);
        });
    }

    function showError(error) {
        console.error("Erro ao carregar notificações:", error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }

    if (!session) {
        document.querySelector("[data-login-required]").hidden = false;
        document.querySelector("[data-read-all]").hidden = true;
        return;
    }
    document.querySelector("[data-read-all]").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
            await window.NEXAApi.request("/notifications/read-all", {
                method: "PATCH",
                body: {}
            });
            await load();
        } catch (error) {
            showError(error);
        } finally {
            event.currentTarget.disabled = false;
        }
    });
    try {
        await load();
    } catch (error) {
        showError(error);
    }
})();
