(async function () {
    const session = await window.NEXASessionReady;
    const list = document.querySelector("[data-moderation-list]");
    const errors = document.querySelector("[data-page-error]");
    const feeForm = document.querySelector("[data-fee-form]");
    const feeRows = document.querySelector("[data-fee-tiers]");
    const feeMessage = document.querySelector("[data-fee-message]");
    let feeRowSequence = 0;

    if (!session || session.role !== "admin") {
        document.querySelector("[data-access-error]").textContent =
            "Esta página está disponível somente para moderadores.";
        document.querySelector("[data-access-error]").hidden = false;
        return;
    }

    function feeRow({ minCents, maxCents, rateBasisPoints }) {
        feeRowSequence += 1;
        const rowId = `fee-tier-${feeRowSequence}`;
        const card = document.createElement("fieldset");
        card.className = "pedido-card";
        card.classList.add("faixa-taxa");
        const legend = document.createElement("legend");
        legend.textContent = "Faixa de preço";
        const minimumLabel = document.createElement("label");
        minimumLabel.textContent = "Mínimo (R$)";
        minimumLabel.htmlFor = `${rowId}-minimum`;
        const minimum = document.createElement("input");
        minimum.id = `${rowId}-minimum`;
        minimum.type = "number";
        minimum.min = "0";
        minimum.step = "0.01";
        minimum.required = true;
        minimum.dataset.feeMinimum = "";
        minimum.value = (Number(minCents) / 100).toFixed(2);
        const maximumLabel = document.createElement("label");
        maximumLabel.textContent = "Máximo (R$; vazio = sem limite)";
        maximumLabel.htmlFor = `${rowId}-maximum`;
        const maximum = document.createElement("input");
        maximum.id = `${rowId}-maximum`;
        maximum.type = "number";
        maximum.min = "0";
        maximum.step = "0.01";
        maximum.dataset.feeMaximum = "";
        maximum.value = maxCents === null ? "" : (Number(maxCents) / 100).toFixed(2);
        const rateLabel = document.createElement("label");
        rateLabel.textContent = "Taxa NEXA (%)";
        rateLabel.htmlFor = `${rowId}-rate`;
        const rate = document.createElement("input");
        rate.id = `${rowId}-rate`;
        rate.type = "number";
        rate.min = "0";
        rate.max = "100";
        rate.step = "0.01";
        rate.required = true;
        rate.dataset.feeRate = "";
        rate.value = (Number(rateBasisPoints) / 100).toFixed(2);
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "botao-excluir";
        remove.dataset.removeFeeTier = "";
        remove.textContent = "Remover faixa";
        card.append(legend, minimumLabel, minimum, maximumLabel, maximum, rateLabel, rate, remove);
        return card;
    }

    function updateFeeRows(tiers) {
        feeRows.replaceChildren(...tiers.map(feeRow));
        updateFeeRemoveButtons();
    }

    function updateFeeRemoveButtons() {
        const rows = [...feeRows.children];
        rows.forEach((row) => {
            row.querySelector("[data-remove-fee-tier]").disabled = rows.length === 1;
        });
    }

    feeRows.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove-fee-tier]");
        if (!remove) return;
        const row = remove.closest(".faixa-taxa");
        const rows = [...feeRows.children];
        const index = rows.indexOf(row);
        const maximum = row.querySelector("[data-fee-maximum]").value;
        if (index === 0 && rows[index + 1]) {
            rows[index + 1].querySelector("[data-fee-minimum]").value = "0.00";
        } else if (index === rows.length - 1 && rows[index - 1]) {
            rows[index - 1].querySelector("[data-fee-maximum]").value = "";
        } else if (rows[index - 1]) {
            rows[index - 1].querySelector("[data-fee-maximum]").value = maximum;
        }
        row.remove();
        updateFeeRemoveButtons();
    });

    function parseCents(value, allowEmpty = false) {
        const normalized = value.trim();
        if (!normalized && allowEmpty) return null;
        if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
            throw new Error("Informe valores em reais com até duas casas decimais.");
        }
        const [whole, fraction = ""] = normalized.split(".");
        const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        if (!Number.isSafeInteger(cents)) throw new Error("O valor informado é muito alto.");
        return cents;
    }

    function readFeeRows() {
        return [...feeRows.children].map((row) => {
            const rate = row.querySelector("[data-fee-rate]").value.trim();
            if (!/^\d+(?:\.\d{1,2})?$/.test(rate)) {
                throw new Error("Informe uma porcentagem válida para cada faixa.");
            }
            const [whole, fraction = ""] = rate.split(".");
            const rateBasisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
            if (!Number.isSafeInteger(rateBasisPoints) || rateBasisPoints > 10000) {
                throw new Error("A taxa precisa estar entre 0% e 100%.");
            }
            return {
                minCents: parseCents(row.querySelector("[data-fee-minimum]").value),
                maxCents: parseCents(row.querySelector("[data-fee-maximum]").value, true),
                rateBasisPoints
            };
        });
    }

    async function loadFeeTiers() {
        const { tiers } = await window.NEXAApi.request("/admin/fee-tiers");
        updateFeeRows(tiers);
    }

    async function moderateListingReport(report, decision, button) {
        button.disabled = true;
        try {
            await window.NEXAApi.request(`/admin/listing-reports/${report.reportId}`, {
                method: "PATCH", body: { decision }
            });
            await load();
        } catch (error) {
            errors.textContent = error.message;
            errors.hidden = false;
            button.disabled = false;
        }
    }

    async function load() {
        const { listings } = await window.NEXAApi.request("/admin/listings?status=pending");
        list.replaceChildren();
        document.querySelector("[data-empty-moderation]").hidden = listings.length > 0;
        listings.forEach((listing) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = listing.title;
            const details = document.createElement("p");
            details.textContent = `${listing.ownerName} · ${listing.ownerEmail} · ${window.NEXAApi.formatPrice(listing.price)}`;
            const description = document.createElement("p");
            description.textContent = listing.description;
            card.append(title, details, description);
            [["approve", "Aprovar"], ["reject", "Recusar"]].forEach(([decision, label]) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = label;
                if (decision === "reject") button.className = "botao-secundario";
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    try {
                        await window.NEXAApi.request(`/admin/listings/${listing.id}`, {
                            method: "PATCH", body: { decision }
                        });
                        await load();
                    } catch (error) {
                        errors.textContent = error.message;
                        errors.hidden = false;
                        button.disabled = false;
                    }
                });
                card.append(button);
            });
            list.append(card);
        });

        const { reports } = await window.NEXAApi.request("/admin/listing-reports");
        const reportList = document.querySelector("[data-reported-listings]");
        reportList.replaceChildren();
        document.querySelector("[data-empty-listing-reports]").hidden = reports.length > 0;
        reports.forEach((report) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = `${report.title} · ${window.NEXAApi.formatPrice(report.price)}`;
            const reporter = document.createElement("p");
            const reportReasons = {
                fraud: "Suspeita de fraude",
                prohibited: "Item ou serviço proibido",
                misleading: "Informação enganosa",
                duplicate: "Anúncio duplicado",
                other: "Outro motivo"
            };
            reporter.textContent = `Denunciado por ${report.reporterName} em ${new Date(report.reportedAt).toLocaleString("pt-BR")} · ${reportReasons[report.reason] ?? report.reason}`;
            const owner = document.createElement("p");
            owner.textContent = `Vendedor: ${report.ownerName}`;
            const description = document.createElement("p");
            description.textContent = report.description;
            const details = document.createElement("p");
            details.textContent = report.details || "Sem detalhes adicionais.";
            card.append(title, reporter, owner, description, details);
            [["dismiss", "Manter anúncio"], ["hide", "Ocultar anúncio"]]
                .forEach(([decision, label]) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = label;
                    if (decision === "hide") button.className = "botao-excluir";
                    button.addEventListener("click", () => moderateListingReport(report, decision, button));
                    card.append(button);
                });
            reportList.append(card);
        });

        const { reviews } = await window.NEXAApi.request("/admin/reviews/reported");
        const reviewList = document.querySelector("[data-reported-reviews]");
        reviewList.replaceChildren();
        document.querySelector("[data-empty-reviews]").hidden = reviews.length > 0;
        reviews.forEach((review) => {
            const card = document.createElement("article");
            card.className = "pedido-card";
            const title = document.createElement("h2");
            title.textContent = `${review.rating}/5 · ${review.reviewerName} avaliou ${review.subjectName} (pedido #${review.orderNumber})`;
            const comment = document.createElement("p");
            comment.textContent = review.comment || "Sem comentário.";
            card.append(title, comment);
            [["dismiss", "Manter avaliação"], ["remove", "Remover avaliação"]]
                .forEach(([decision, label]) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.textContent = label;
                    if (decision === "remove") button.className = "botao-excluir";
                    button.addEventListener("click", async () => {
                        button.disabled = true;
                        try {
                            await window.NEXAApi.request(`/admin/reviews/${review.id}`, {
                                method: "PATCH", body: { decision }
                            });
                            await load();
                        } catch (error) {
                            errors.textContent = error.message;
                            errors.hidden = false;
                            button.disabled = false;
                        }
                    });
                    card.append(button);
                });
            reviewList.append(card);
        });
    }

    document.querySelector("[data-add-fee-tier]").addEventListener("click", () => {
        const rows = [...feeRows.children];
        const last = rows.at(-1);
        const minInput = last.querySelector("[data-fee-minimum]");
        const maxInput = last.querySelector("[data-fee-maximum]");
        const nextMinCents = parseCents(minInput.value) + 10000;
        maxInput.value = ((nextMinCents - 1) / 100).toFixed(2);
        const nextRate = Number(last.querySelector("[data-fee-rate]").value) * 100;
        feeRows.append(feeRow({
            minCents: nextMinCents,
            maxCents: null,
            rateBasisPoints: Math.round(nextRate)
        }));
        updateFeeRemoveButtons();
    });

    feeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = feeForm.querySelector('button[type="submit"]');
        feeMessage.hidden = true;
        button.disabled = true;
        try {
            const { tiers } = await window.NEXAApi.request("/admin/fee-tiers", {
                method: "PUT", body: { tiers: readFeeRows() }
            });
            updateFeeRows(tiers);
            feeMessage.textContent = "Faixas de taxa salvas. Elas serão aplicadas somente a novos pedidos.";
            feeMessage.hidden = false;
        } catch (error) {
            feeMessage.textContent = error.message;
            feeMessage.classList.add("mensagem-erro");
            feeMessage.hidden = false;
        } finally {
            button.disabled = false;
        }
    });

    try {
        await Promise.all([load(), loadFeeTiers()]);
    } catch (error) {
        console.error("Erro ao carregar o painel de moderação:", error);
        errors.textContent = error.message;
        errors.hidden = false;
    }
})();
