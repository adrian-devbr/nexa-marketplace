(function () {
    function userKey() {
        return window.NEXAStore.session.get()?.userId ?? "guest";
    }

    function idsFavoritos() {
        return new Set(window.NEXAStore.favorites.getAll(userKey()));
    }

    function atualizarBotao(botao, salvo) {
        botao.setAttribute("aria-pressed", String(salvo));
        botao.setAttribute(
            "aria-label",
            salvo ? "Remover dos salvos" : "Salvar anúncio"
        );
        botao.title = salvo ? "Remover dos salvos" : "Salvar anúncio";
        botao.textContent = salvo ? "♥" : "♡";
        botao.classList.toggle("esta-salvo", salvo);
    }

    function inicializarBotao(botao) {
        const itemId = botao.dataset.favoriteId;

        if (!itemId) {
            return;
        }

        atualizarBotao(botao, idsFavoritos().has(itemId));
    }

    window.addEventListener("nexa:session", () => {
        document.querySelectorAll(".favorito-toggle[data-favorite-id], #favorito-detalhe")
            .forEach(inicializarBotao);
    });

    function alternar(itemId) {
        if (!itemId) {
            return false;
        }

        return window.NEXAStore.favorites.toggle(userKey(), itemId);
    }

    window.NEXAFavorites = Object.freeze({
        ids: idsFavoritos,
        toggle: alternar,
        initializeButton: inicializarBotao,
        updateButton: atualizarBotao
    });
})();
