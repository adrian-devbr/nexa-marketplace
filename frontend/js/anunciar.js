(async function () {
    const formularioAnuncio = document.querySelector("[data-listing-form]");
    const mensagemAutenticacao = document.querySelector("[data-auth-required]");
    let anuncioEdicao = null;
    const idAnuncioEdicao = new URLSearchParams(window.location.search).get("editar");
    const sessao = await window.NEXASessionReady;

    if (sessao && formularioAnuncio) {
        formularioAnuncio.hidden = false;
        if (idAnuncioEdicao) {
            try {
                const { listings } = await window.NEXAApi.request("/listings/mine/list");
                anuncioEdicao = listings.find((listing) => listing.id === idAnuncioEdicao);
                if (!anuncioEdicao) throw new Error("Este anúncio não pertence à sua conta.");

                formularioAnuncio.elements.type.value = anuncioEdicao.type;
                formularioAnuncio.elements.title.value = anuncioEdicao.title;
                formularioAnuncio.elements.category.value = anuncioEdicao.category;
                formularioAnuncio.elements.description.value = anuncioEdicao.description;
                formularioAnuncio.elements.price.value = anuncioEdicao.price;
                formularioAnuncio.elements.image.value = anuncioEdicao.image ?? "";
                document.querySelector("[data-listing-heading]").textContent = "Editar anúncio";
                document.querySelector("[data-listing-submit]").textContent = "Salvar alterações";
                document.title = "Editar anúncio | NEXA";
            } catch (error) {
                console.error("Erro ao abrir anúncio para edição:", error);
                formularioAnuncio.hidden = true;
                mensagemAutenticacao.textContent = error.message;
                mensagemAutenticacao.hidden = false;
            }
        }
    } else if (mensagemAutenticacao) {
        mensagemAutenticacao.hidden = false;
    }

    formularioAnuncio?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const mensagem = formularioAnuncio.querySelector("[data-form-message]");
        const dados = new FormData(formularioAnuncio);
        const body = {
            type: String(dados.get("type")),
            title: String(dados.get("title")).trim(),
            category: String(dados.get("category")).trim(),
            description: String(dados.get("description")).trim(),
            price: Number(dados.get("price")),
            image: String(dados.get("image")).trim()
        };
        const botao = formularioAnuncio.querySelector("[data-listing-submit]");
        botao.disabled = true;
        try {
            await window.NEXAApi.request(
                anuncioEdicao ? `/listings/${anuncioEdicao.id}` : "/listings",
                { method: anuncioEdicao ? "PUT" : "POST", body }
            );
            window.location.replace("/pages/painel.html");
        } catch (error) {
            console.error("Erro ao salvar o anúncio:", error);
            mensagem.textContent = error.message;
            mensagem.classList.add("mensagem-erro");
            mensagem.hidden = false;
        } finally {
            botao.disabled = false;
        }
    });
})();
