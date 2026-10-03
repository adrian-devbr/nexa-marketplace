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
- Anúncios de produtos e serviços publicados imediatamente, com validação de
  entrada e moderação posterior por denúncias.
- Mensagens associadas a anúncios, histórico, leitura, bloqueio e limites de envio.
- Central de notificações para mensagens, pedidos, avaliações e anúncios.
- Pedidos com preço e quantidade calculados e registrados no servidor.
- Histórico de status do pedido, da espera pelo vendedor até a conclusão.
- Faixas de comissão configuráveis pelo administrador e gravadas como snapshot
  financeiro em cada novo pedido.
- Avaliações de 1 a 5 estrelas após a conclusão do pedido.
- Painel para revisar denúncias de anúncios e avaliações e configurar taxas.
- Checkout hospedado do Mercado Pago, preparado para credenciais de teste e
  confirmação de pagamento pelo webhook assinado. A cobrança só fica disponível
  depois que o vendedor aceita o pedido.

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

4. Acesse `http://localhost:3000`, crie a conta usando o e-mail configurado como
   moderador. Os anúncios são publicados no envio; denúncias posteriores podem
   ser revisadas na página **Moderação**.

Para ativar o checkout local, preencha `MP_ACCESS_TOKEN` com uma credencial
`TEST-` do Mercado Pago e configure `MP_WEBHOOK_SECRET` e `APP_BASE_URL` no
arquivo local `backend/.env`. Sem essas credenciais, os pedidos funcionam, mas
o checkout informa que os pagamentos não estão configurados.
Para preencher os segredos sem exibi-los no terminal, use
`.\configurar-pagamentos.ps1` dentro da pasta `backend`; ele exige uma URL HTTPS
pública (por exemplo, um túnel local) para receber o webhook. Cadastre a URL
`/api/payments/webhook` e a assinatura secreta correspondente no painel do
Mercado Pago. Reinicie o servidor depois de salvar.

Na página **Moderação**, um administrador pode ajustar as faixas da taxa NEXA.
Os valores aplicados ficam registrados no pedido e não mudam quando uma faixa
for alterada depois. As faixas iniciais são 10% até R$ 50, 8% até R$ 200, 6%
até R$ 500, 5% até R$ 1.000 e 4% acima disso.

## Testes

```powershell
Set-Location backend
npm test
```

## Pagamentos e limites do protótipo

O pedido segue este fluxo: comprador solicita → vendedor aceita ou recusa →
comprador paga no checkout hospedado → webhook assinado confirma com o Mercado
Pago → vendedor inicia a entrega. O NEXA não recebe nem armazena dados de cartão.
O valor anunciado permanece o total cobrado do comprador. A taxa NEXA é
calculada no backend no momento do pedido; a tarifa do Mercado Pago é registrada
quando retornada pelo provedor após o pagamento. A tela do navegador não pode
declarar um pagamento como aprovado.

O saldo líquido apresentado é um cálculo financeiro de referência. **O
repasse dividido/automático ao vendedor ainda não está integrado**; não se deve
interpretar o valor como dinheiro já retido ou transferido. Para isso, ainda
são necessárias contas de vendedor e a integração de marketplace apropriada do
Mercado Pago.

**Este projeto ainda não está pronto para processar dinheiro real ou para
lançamento público.** O backend bloqueia intencionalmente cobranças reais até a
integração de marketplace e repasses estar implementada e validada. Ainda faltam
credenciais e webhook público do Mercado Pago, regras operacionais para
reembolsos e disputas, revisão legal/fiscal, banco e hospedagem de produção com
HTTPS, monitoramento e procedimentos de suporte. Não use credenciais de teste
para cobrar usuários reais.

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
