const formularioConta = document.querySelector("[data-account-form]");

function mostrarMensagem(mensagem, erro = false) {
    const elemento = document.querySelector("[data-form-message]");
    if (!elemento) return;
    elemento.textContent = mensagem;
    elemento.classList.toggle("mensagem-erro", erro);
    elemento.hidden = false;
}

formularioConta?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const dados = new FormData(formularioConta);
    const modo = formularioConta.dataset.accountForm;
    const botaoEnviar = formularioConta.querySelector('button[type="submit"]');
    const body = {
        email: String(dados.get("email")).trim(),
        password: String(dados.get("password"))
    };
    if (modo === "register") {
        const nome = String(dados.get("name")).trim();
        if (body.password !== String(dados.get("confirmPassword"))) {
            mostrarMensagem("As senhas não são iguais.", true);
            return;
        }
        body.name = nome;
    }

    botaoEnviar.disabled = true;
    try {
        await window.NEXAApi.request(`/auth/${modo}`, { method: "POST", body });
        window.location.replace("/");
    } catch (error) {
        mostrarMensagem(error.message, true);
    } finally {
        botaoEnviar.disabled = false;
    }
});
