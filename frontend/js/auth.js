window.NEXASessionReady = (async function () {
    const loginLink = document.querySelector("[data-auth-link]");
    const memberLinks = document.querySelectorAll("[data-member-link]");

    try {
        const { user } = await window.NEXAApi.request("/auth/me");
        window.NEXAStore.session.set({
            userId: user.id,
            name: user.name,
            email: user.email,
            role: user.role
        });
        window.dispatchEvent(new Event("nexa:session"));
        memberLinks.forEach((link) => {
            link.hidden = false;
        });

        const menu = document.querySelector("nav .menu");
        const links = [
            ["Mensagens", "mensagens.html"],
            ["Pedidos", "pedidos.html"],
            ["Notificações", "notificacoes.html"]
        ];
        links.forEach(([label, page]) => {
            const link = document.createElement("a");
            link.href = `/pages/${page}`;
            link.dataset.memberLink = "";
            link.textContent = label;
            menu?.insertBefore(link, loginLink ?? null);
        });
        if (user.role === "admin") {
            const link = document.createElement("a");
            link.href = "/pages/admin.html";
            link.dataset.memberLink = "";
            link.textContent = "Moderação";
            menu?.insertBefore(link, loginLink ?? null);
        }

        const notificationLink = [...document.querySelectorAll("nav a")]
            .find((link) => link.getAttribute("href") === "/pages/notificacoes.html");
        const messagesLink = [...document.querySelectorAll("nav a")]
            .find((link) => link.getAttribute("href") === "/pages/mensagens.html");
        if (messagesLink) {
            try {
                const { conversations } = await window.NEXAApi.request("/conversations");
                const unreadCount = conversations.reduce(
                    (count, conversation) => count + conversation.unreadCount,
                    0
                );
                if (unreadCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "contador-notificacoes";
                    badge.textContent = String(unreadCount);
                    badge.setAttribute("aria-label", `${unreadCount} mensagens não lidas`);
                    messagesLink.append(" ", badge);
                }
            } catch (error) {
                console.error("Não foi possível carregar o contador de mensagens:", error);
            }
        }
        if (notificationLink) {
            try {
                const { unreadCount } = await window.NEXAApi.request("/notifications");
                if (unreadCount > 0) {
                    const badge = document.createElement("span");
                    badge.className = "contador-notificacoes";
                    badge.textContent = String(unreadCount);
                    badge.setAttribute("aria-label", `${unreadCount} notificações não lidas`);
                    notificationLink.append(" ", badge);
                }
            } catch (error) {
                console.error("Não foi possível carregar o contador de notificações:", error);
            }
        }

        if (loginLink) {
            loginLink.textContent = `Sair (${user.name})`;
            loginLink.href = "#sair";
            loginLink.setAttribute("aria-label", `Sair da conta de ${user.name}`);
            loginLink.addEventListener("click", async (event) => {
                event.preventDefault();
                loginLink.setAttribute("aria-disabled", "true");
                try {
                    await window.NEXAApi.request("/auth/logout", { method: "POST" });
                    window.NEXAStore.session.clear();
                    window.location.assign("/");
                } catch (error) {
                    console.error("Não foi possível encerrar a sessão:", error);
                    window.alert(error.message);
                    loginLink.removeAttribute("aria-disabled");
                }
            });
        }
        return user;
    } catch (error) {
        window.NEXAStore.session.clear();
        if (error.status !== 401) {
            console.error("Não foi possível validar a sessão no NEXA:", error);
        }
        return null;
    }
})();
