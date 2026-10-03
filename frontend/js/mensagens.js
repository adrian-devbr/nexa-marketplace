(async function () {
    const session = await window.NEXASessionReady;
    const app = document.querySelector("[data-messaging-app]");
    const loginMessage = document.querySelector("[data-login-required]");
    const thread = document.querySelector("[data-thread]");
    const errorMessage = document.querySelector("[data-page-error]");
    const list = document.querySelector("[data-conversations]");
    const history = document.querySelector("[data-message-history]");
    let selectedId = new URLSearchParams(window.location.search).get("conversation");
    let refreshInProgress = false;

    function showError(error) {
        console.error("Erro ao carregar mensagens:", error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
    }

    function formatDate(value) {
        return new Date(value).toLocaleString("pt-BR", {
            dateStyle: "short",
            timeStyle: "short"
        });
    }

    function buildConversationCard(conversation) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "conversa-item";
        button.dataset.conversationId = conversation.id;
        button.setAttribute("aria-current", String(conversation.id === selectedId));
        const name = document.createElement("strong");
        name.textContent = conversation.otherUserName;
        const listing = document.createElement("span");
        listing.textContent = conversation.listingTitle;
        const last = document.createElement("span");
        last.textContent = conversation.lastMessage ?? "Conversa iniciada";
        button.append(name, listing, last);
        if (conversation.unreadCount > 0) {
            const unread = document.createElement("span");
            unread.className = "mensagens-nao-lidas";
            unread.textContent = String(conversation.unreadCount);
            unread.setAttribute("aria-label", `${conversation.unreadCount} não lidas`);
            button.append(unread);
        }
        return button;
    }

    async function loadConversations() {
        const { conversations } = await window.NEXAApi.request("/conversations");
        list.replaceChildren();
        conversations.forEach((conversation) => list.append(buildConversationCard(conversation)));
        document.querySelector("[data-empty-conversations]").hidden = conversations.length > 0;
        if (!selectedId && conversations.length) selectedId = conversations[0].id;
        if (selectedId && conversations.some(({ id }) => id === selectedId)) {
            await loadThread();
        } else {
            selectedId = null;
            thread.hidden = true;
        }
    }

    async function loadBlockedUsers() {
        const { blockedUsers } = await window.NEXAApi.request("/conversations/blocked");
        const container = document.querySelector("[data-blocked-users]");
        container.replaceChildren();
        blockedUsers.forEach((blocked) => {
            const row = document.createElement("div");
            row.className = "usuario-bloqueado";
            const name = document.createElement("span");
            name.textContent = blocked.userName;
            const unblock = document.createElement("button");
            unblock.type = "button";
            unblock.className = "botao-secundario";
            unblock.textContent = "Desbloquear";
            unblock.addEventListener("click", async () => {
                unblock.disabled = true;
                try {
                    await window.NEXAApi.request(
                        `/conversations/${blocked.conversationId}/block`,
                        { method: "DELETE" }
                    );
                    await loadBlockedUsers();
                    if (blocked.conversationId === selectedId) await loadThread();
                } catch (error) {
                    showError(error);
                    unblock.disabled = false;
                }
            });
            row.append(name, unblock);
            container.append(row);
        });
        if (!blockedUsers.length) {
            container.textContent = "Nenhuma pessoa bloqueada.";
        }
    }

    async function loadThread() {
        if (!selectedId) return;
        const { conversation, messages } = await window.NEXAApi.request(
            `/conversations/${selectedId}/messages`
        );
        thread.hidden = false;
        document.querySelector("[data-thread-title]").textContent =
            conversation.otherUserName;
        const messageForm = document.querySelector("[data-message-form]");
        [...messageForm.elements].forEach((element) => {
            element.disabled = conversation.isBlocked;
        });
        const blockButton = document.querySelector("[data-block-user]");
        blockButton.disabled = conversation.isBlocked;
        blockButton.textContent = conversation.isBlocked
            ? "Pessoa bloqueada"
            : "Bloquear pessoa";
        const profile = document.querySelector("[data-profile-link]");
        profile.href = `/pages/perfil.html?user=${encodeURIComponent(conversation.otherUserId)}`;
        const preview = document.querySelector("[data-listing-preview]");
        preview.replaceChildren();
        if (conversation.listingImage) {
            const image = document.createElement("img");
            image.src = conversation.listingImage;
            image.alt = "";
            preview.append(image);
        }
        const listingLink = document.createElement("a");
        listingLink.href = `/pages/produto.html?item=${encodeURIComponent(conversation.listingId)}`;
        listingLink.textContent = `${conversation.listingTitle} · ${window.NEXAApi.formatPrice(conversation.listingPrice)}`;
        preview.append(listingLink);

        const oldHeight = history.scrollHeight;
        const wasNearBottom =
            history.scrollHeight - history.scrollTop - history.clientHeight < 80;
        history.replaceChildren();
        messages.forEach((message) => {
            const bubble = document.createElement("article");
            const mine = message.senderId === session.id;
            bubble.className = mine ? "mensagem-balao enviada" : "mensagem-balao recebida";
            const body = document.createElement("p");
            body.textContent = message.body;
            const meta = document.createElement("time");
            meta.dateTime = message.createdAt;
            meta.textContent = `${formatDate(message.createdAt)}${mine ? message.readAt ? " · Lida" : " · Enviada" : ""}`;
            bubble.append(body, meta);
            history.append(bubble);
        });
        if (wasNearBottom || history.scrollHeight > oldHeight) {
            history.scrollTop = history.scrollHeight;
        }
    }

    if (!session) {
        loginMessage.hidden = false;
        return;
    }
    app.hidden = false;
    try {
        await loadConversations();
        await loadBlockedUsers();
    } catch (error) {
        showError(error);
    }

    list.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-conversation-id]");
        if (!button) return;
        selectedId = button.dataset.conversationId;
        window.history.replaceState(null, "", `?conversation=${encodeURIComponent(selectedId)}`);
        try {
            await loadConversations();
        } catch (error) {
            showError(error);
        }
    });

    document.querySelector("[data-message-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector("button[type=submit]");
        const body = String(new FormData(form).get("body")).trim();
        if (!body || !selectedId) return;
        button.disabled = true;
        try {
            await window.NEXAApi.request(`/conversations/${selectedId}/messages`, {
                method: "POST",
                body: { body }
            });
            form.reset();
            await loadThread();
            await loadConversations();
        } catch (error) {
            showError(error);
        } finally {
            button.disabled = false;
        }
    });

    document.querySelector("[data-delete-conversation]").addEventListener("click", async () => {
        if (!selectedId || !window.confirm("Excluir esta conversa da sua lista?")) return;
        try {
            await window.NEXAApi.request(`/conversations/${selectedId}`, { method: "DELETE" });
            selectedId = null;
            window.history.replaceState(null, "", window.location.pathname);
            await loadConversations();
        } catch (error) {
            showError(error);
        }
    });

    document.querySelector("[data-block-user]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            await window.NEXAApi.request(`/conversations/${selectedId}/block`, {
                method: "POST",
                body: {}
            });
            button.textContent = "Pessoa bloqueada";
            [...document.querySelector("[data-message-form]").elements]
                .forEach((element) => {
                    element.disabled = true;
                });
            await loadBlockedUsers();
        } catch (error) {
            showError(error);
            button.disabled = false;
        }
    });

    window.setInterval(async () => {
        if (!selectedId || document.hidden || refreshInProgress) return;
        refreshInProgress = true;
        try {
            await loadThread();
            await loadConversations();
        } catch (error) {
            showError(error);
        } finally {
            refreshInProgress = false;
        }
    }, 10000);
})();
