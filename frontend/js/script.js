const busca = document.querySelector(".busca");
const campoBusca = busca?.querySelector('input[name="busca"]');
const produtosContainer = document.querySelector(".produtos-container");
const mensagemNenhumResultado = document.querySelector(".nenhum-resultado");
const botoesCategoria = [...document.querySelectorAll(".categoria[data-filtro]")];
const filtroPadrao = new URLSearchParams(window.location.search).get("tipo");

let filtroAtual = ["produto", "servico", "salvos"].includes(filtroPadrao)
    ? filtroPadrao
    : "todos";
let erroCarregamentoAnuncios = false;

function normalizar(texto) {
    return texto
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("pt-BR")
        .trim();
}

function atualizarProdutos() {
    const termo = normalizar(campoBusca?.value ?? "");
    let favoritos;
    let quantidadeVisivel = 0;

    try {
        favoritos = window.NEXAFavorites.ids();
    } catch (error) {
        console.error("Erro ao ler os anúncios salvos:", error);
        if (mensagemNenhumResultado) {
            mensagemNenhumResultado.textContent =
                "Não foi possível carregar seus anúncios salvos neste navegador.";
            mensagemNenhumResultado.hidden = false;
        }
        return;
    }

    document.querySelectorAll(".produto").forEach((produto) => {
        const itemId = produto.dataset.itemId;
        const correspondeTipo = filtroAtual === "todos" ||
            filtroAtual === "salvos" ||
            produto.dataset.tipo === filtroAtual;
        const correspondeFavorito =
            filtroAtual !== "salvos" || favoritos.has(itemId);
        const correspondeBusca = normalizar(produto.textContent).includes(termo);
        const visivel = correspondeTipo && correspondeFavorito && correspondeBusca;

        produto.hidden = !visivel;
        quantidadeVisivel += Number(visivel);
    });

    if (mensagemNenhumResultado) {
        mensagemNenhumResultado.textContent = filtroAtual === "salvos"
            ? "Você ainda não salvou nenhum anúncio que corresponda à pesquisa."
            : quantidadeVisivel === 0
                ? "Ainda não há anúncios publicados. Seja o primeiro a anunciar."
                : "Nenhum item encontrado.";
        mensagemNenhumResultado.hidden = quantidadeVisivel > 0;
        if (erroCarregamentoAnuncios) {
            mensagemNenhumResultado.textContent =
                "Não foi possível carregar anúncios publicados. Tente novamente mais tarde.";
            mensagemNenhumResultado.hidden = false;
        }
    }
}

function criarElemento(tag, texto, className) {
    const elemento = document.createElement(tag);
    elemento.textContent = texto;

    if (className) {
        elemento.className = className;
    }

    return elemento;
}

async function adicionarAnunciosSalvos() {
    if (!produtosContainer || !window.NEXAApi) {
        return;
    }

    try {
        const { listings: anuncios } = await window.NEXAApi.request("/listings");

        anuncios.forEach((anuncio) => {
            const card = document.createElement("article");
            card.className = "produto";
            card.dataset.tipo = anuncio.type;
            card.dataset.itemId = anuncio.id;

            if (anuncio.image) {
                const imagem = document.createElement("img");
                imagem.src = anuncio.image;
                imagem.alt = `Imagem de ${anuncio.title}`;
                imagem.loading = "lazy";
                imagem.decoding = "async";
                card.append(imagem);
            } else {
                card.append(criarElemento("span", anuncio.type === "servico" ? "🛠️" : "📦", "servico-icone"));
            }

            card.append(
                criarElemento("h3", anuncio.title),
                criarElemento("p", anuncio.description),
                criarElemento("p", `Categoria: ${anuncio.category}`, "categoria-produto"),
                criarElemento("p", `Preço: ${window.NEXAApi.formatPrice(anuncio.price)}`, "preco"),
                criarElemento("p", `Anunciado por: ${anuncio.ownerName}`, "anunciante")
            );

            if (Number(anuncio.rating) > 0) {
                card.append(criarElemento(
                    "span",
                    `⭐ ${Number(anuncio.rating).toLocaleString("pt-BR")} · ${anuncio.reviewCount} avaliações`,
                    "avaliacao"
                ));
            }

            const detalhes = criarElemento("button", "Ver detalhes", "detalhes");
            detalhes.type = "button";
            detalhes.dataset.itemId = anuncio.id;
            card.append(detalhes);
            card.append(criarBotaoFavorito(anuncio.id));
            produtosContainer.append(card);
        });
    } catch (error) {
        erroCarregamentoAnuncios = true;
        if (mensagemNenhumResultado) {
            mensagemNenhumResultado.hidden = false;
            mensagemNenhumResultado.textContent = error.status === 401
                ? "Entre novamente para continuar usando o NEXA."
                : "Não foi possível carregar anúncios. Tente novamente mais tarde.";
        }
        console.error("Erro ao carregar anúncios publicados:", error);
    }
}

function criarBotaoFavorito(itemId) {
    const botao = criarElemento("button", "♡", "favorito-toggle");
    botao.type = "button";
    botao.dataset.favoriteId = itemId;
    window.NEXAFavorites.initializeButton(botao);
    return botao;
}

document.querySelectorAll(".produto").forEach((produto) => {
    const itemId = produto.dataset.itemId ??
        produto.querySelector(".detalhes[data-item-id]")?.dataset.itemId;

    if (itemId) {
        produto.dataset.itemId = itemId;

        if (!produto.querySelector(".favorito-toggle")) {
            produto.append(criarBotaoFavorito(itemId));
        }
    }
});

busca?.addEventListener("submit", (event) => {
    event.preventDefault();
    atualizarProdutos();
});

campoBusca?.addEventListener("input", atualizarProdutos);

botoesCategoria.forEach((botao) => {
    botao.addEventListener("click", () => {
        filtroAtual = botao.dataset.filtro ?? "todos";

        botoesCategoria.forEach((outroBotao) => {
            outroBotao.setAttribute("aria-pressed", String(outroBotao === botao));
        });

        if (campoBusca) {
            campoBusca.value = "";
        }

        if (filtroAtual === "salvos") {
            window.location.hash = "destaques";
        }

        atualizarProdutos();
    });
});

document.addEventListener("click", (event) => {
    const favorito = event.target.closest(".favorito-toggle[data-favorite-id]");

    if (favorito) {
        try {
            const salvo = window.NEXAFavorites.toggle(favorito.dataset.favoriteId);
            window.NEXAFavorites.updateButton(favorito, salvo);
            atualizarProdutos();
        } catch (error) {
            console.error("Erro ao atualizar anúncio salvo:", error);
            if (mensagemNenhumResultado) {
                mensagemNenhumResultado.textContent =
                    "Não foi possível salvar este anúncio neste navegador.";
                mensagemNenhumResultado.hidden = false;
            }
        }
        return;
    }

    const botao = event.target.closest(".detalhes[data-item-id]");

    if (botao) {
        window.location.href =
            `pages/produto.html?item=${encodeURIComponent(botao.dataset.itemId)}`;
    }
});

window.addEventListener("storage", (event) => {
    if (event.key === "nexa.favorites.v1") {
        document.querySelectorAll(".favorito-toggle").forEach((botao) => {
            window.NEXAFavorites.initializeButton(botao);
        });
        atualizarProdutos();
    }
});

if (filtroAtual !== "todos") {
    botoesCategoria.forEach((botao) => {
        botao.setAttribute(
            "aria-pressed",
            String(botao.dataset.filtro === filtroAtual)
        );
    });
}

adicionarAnunciosSalvos().then(atualizarProdutos);
atualizarProdutos();
