<div align="center">

# NEXA

### Marketplace para conectar compradores e vendedores.

Anúncios · conversas · pedidos · avaliações · notificações

**Projeto de portfólio de Adrian · Em desenvolvimento**

</div>

---

O **NEXA** é um marketplace full-stack desenvolvido para transformar uma
experiência de catálogo em uma jornada completa: a pessoa anuncia, conversa
com vendedores, acompanha pedidos e avalia a experiência.

## Funcionalidades

- Cadastro e login com senhas protegidas por bcrypt e sessão em cookie HttpOnly.
- Anúncios de produtos e serviços, com aprovação antes da publicação.
- Mensagens associadas a anúncios, histórico, leitura, bloqueio e limites de envio.
- Central de notificações para mensagens, pedidos, avaliações e anúncios.
- Pedidos com preço e quantidade calculados e registrados no servidor.
- Fluxo de status de pedidos com verificações de comprador e vendedor.
- Avaliações de 1 a 5 estrelas após a conclusão do pedido.
- Painel de moderação para aprovar anúncios e revisar avaliações denunciadas.
- Checkout hospedado do Mercado Pago, preparado para credenciais de teste e
  confirmação de pagamento pelo webhook assinado.

## Tecnologias

| Área | Tecnologias |
| --- | --- |
| Interface | HTML, CSS e JavaScript |
| Servidor | Node.js e Express |
| Persistência | PostgreSQL |
| Validação | Zod |
| Segurança | bcrypt, cookies HttpOnly, Helmet e limitação de requisições |
| Pagamentos | Mercado Pago Checkout Pro (credenciais de teste) |
| Testes | Node.js Test Runner |

## Rodar localmente

**Requisitos:** Node.js 20 ou superior e PostgreSQL.

1. Crie um banco chamado `nexa`.
2. No PowerShell, na raiz do projeto:

   ```powershell
   Set-Location backend
   npm install
   .\configurar.ps1
   ```

   O configurador pede a senha do PostgreSQL sem exibi-la, gera uma chave de
   sessão e aplica o esquema. Informe o e-mail da conta moderadora quando
   solicitado. O arquivo local `backend/.env` não deve ser compartilhado.
3. Inicie o servidor:

   ```powershell
   npm run dev
   ```

4. Acesse `http://localhost:3000`, crie a conta com o e-mail de moderador e
   aprove os anúncios na página **Moderação**.

## Testes

```powershell
Set-Location backend
npm test
```

## Pagamentos e limites do protótipo

O pagamento é feito em uma página hospedada pelo provedor: o NEXA não recebe nem
armazena dados de cartão. O checkout fica desativado até configurar credenciais
de teste `TEST-` do Mercado Pago e o segredo do webhook no `.env`. O servidor
confirma o pagamento junto ao provedor; a tela do navegador não pode declará-lo
pago.

**Este projeto ainda não está pronto para processar dinheiro real ou para
lançamento público.** Split de pagamentos e taxas, saques, custódia, reembolsos
operacionais, revisão legal/fiscal, infraestrutura HTTPS de produção e outras
medidas operacionais ainda precisam ser projetadas e revisadas.

## Estrutura

```text
backend/
  db/schema.sql
  src/
    routes/       # contas, anúncios, conversas, pedidos e pagamentos
    server.js
  test/
frontend/
  css/
  js/
  pages/
```

## Sobre o projeto

O NEXA faz parte da jornada de aprendizado e construção de produtos de
[Adrian](https://github.com/adrian-devbr). Veja também o
[README de apresentação do perfil](./profile/README.md).
