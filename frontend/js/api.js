(function () {
    async function request(path, options = {}) {
        const settings = {
            method: options.method ?? "GET",
            credentials: "same-origin",
            headers: { Accept: "application/json", ...options.headers }
        };

        if (options.body !== undefined) {
            settings.headers["Content-Type"] = "application/json";
            settings.body = JSON.stringify(options.body);
        }

        const response = await fetch(`/api${path}`, settings);
        if (response.status === 204) return null;

        const contentType = response.headers.get("content-type") ?? "";
        const data = contentType.includes("application/json")
            ? await response.json()
            : null;
        if (!response.ok) {
            const error = new Error(data?.error ?? "Não foi possível concluir a solicitação.");
            error.status = response.status;
            error.details = data?.details ?? [];
            throw error;
        }
        return data;
    }

    function formatPrice(value) {
        return new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL"
        }).format(Number(value));
    }

    window.NEXAApi = Object.freeze({ request, formatPrice });
})();
