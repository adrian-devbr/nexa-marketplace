(async function () {
    const listaAnuncios = document.querySelector("[data-listings]");
    const mensagemLogin = document.querySelector("[data-login-required]");
    const mensagemVazio = document.querySelector("[data-empty-listings]");
    const mensagemErro = document.querySelector("[data-panel-error]");
    const session = await window.NEXASessionReady;

    function criarTexto(tag, texto, classe) {
        const elemento = document.createElement(tag);
        elemento.textContent = texto;
        if (classe) elemento.className = classe;
        return elemento;
    }

    async function renderizar() {
        if (!session || !listaAnuncios) {
            if (mensagemLogin) mensagemLogin.hidden = false;
            return;
        }
        try {
            const { listings } = await window.NEXAApi.request("/listings/mine/list");
            mensagemVazio.hidden = listings.length > 0;
            listaAnuncios.hidden = listings.length === 0;
            listaAnuncios.replaceChildren();
            listings.forEach((listing) => {
                const card = document.createElement("article");
                card.className = "anuncio-gerenciado";
                const info = document.createElement("div");
                info.className = "anuncio-gerenciado-info";
                const statusText = {
                    pending: "Em análise",
                    published: "Publicado",
                    rejected: "Recusado",
                    hidden: "Oculto"
                }[listing.status] ?? "Indisponível";
                info.append(
                    criarTexto("span", statusText, "etiqueta"),
                    criarTexto("h2", listing.title),
                    criarTexto(
                        "p",
                        `${listing.category} · ${window.NEXAApi.formatPrice(listing.price)}`,
                        "texto-secundario"
                    )
                );
                const actions = document.createElement("div");
                actions.className = "acoes-anuncio";
                if (listing.status === "published") {
                    const view = document.createElement("a");
                    view.className = "botao-link botao-secundario";
                    view.href = `/pages/produto.html?item=${encodeURIComponent(listing.id)}`;
                    view.textContent = "Ver";
                    actions.append(view);
                }
                if (listing.status !== "hidden") {
                    const edit = document.createElement("a");
                    edit.className = "botao-link botao-secundario";
                    edit.href = `/pages/anunciar.html?editar=${encodeURIComponent(listing.id)}`;
                    edit.textContent = "Editar";
                    actions.append(edit);
                    const remove = document.createElement("button");
                    remove.type = "button";
                    remove.className = "botao-excluir";
                    remove.dataset.deleteListing = listing.id;
                    remove.textContent = "Excluir";
                    actions.append(remove);
                }
                card.append(info, actions);
                listaAnuncios.append(card);
            });
        } catch (error) {
            console.error("Erro ao carregar o painel:", error);
            mensagemErro.textContent = error.message;
            mensagemErro.classList.add("mensagem-erro");
            mensagemErro.hidden = false;
        }
    }

    listaAnuncios?.addEventListener("click", async (event) => {
        const button = event.target.closest("[data-delete-listing]");
        if (!button || !window.confirm("Deseja ocultar este anúncio?")) return;
        button.disabled = true;
        try {
            await window.NEXAApi.request(`/listings/${button.dataset.deleteListing}`, {
                method: "DELETE"
            });
            await renderizar();
        } catch (error) {
            console.error("Erro ao ocultar o anúncio:", error);
            mensagemErro.textContent = error.message;
            mensagemErro.classList.add("mensagem-erro");
            mensagemErro.hidden = false;
            button.disabled = false;
        }
    });

    await renderizar();
})();
