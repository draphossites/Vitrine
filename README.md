# Vitrine

Plataforma de catálogos com pedidos pelo WhatsApp. O lojista gerencia produtos, fotos, preços, disponibilidade e pedidos. O painel Adimin gerencia lojas, usuários, assinaturas e a aprovação manual de pagamentos.

## Enviar para o GitHub

Descompacte o ZIP e abra um terminal na pasta que contém este README. Crie um repositório vazio no GitHub, substitua `SEU-USUARIO` e `SEU-REPOSITORIO` pelo endereço dele e execute os comandos.

```sh
git init
git add .
git commit -m "Adiciona a Vitrine"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

## Rodar no computador

Instale o Node.js 22.13 ou superior com npm. Na pasta do projeto, instale as dependências, compile o servidor e aplique a migração ao banco local.

```sh
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_vitrine.sql
```

A migração acima é para a primeira execução com um banco local vazio. Para testar o Adimin, rode `npm run configurar:adimin` no terminal e escolha um e-mail e uma senha locais. O comando cria o arquivo `.dev.vars`, ignorado pelo Git.

```sh
npm run dev
```

Abra o endereço mostrado pelo terminal. A porta padrão é 5173.

- `/loja/turbo-demo` abre uma loja de demonstração.
- `/lojista` abre o painel do lojista. O botão **Entrar com ChatGPT** usa a conta simulada da prévia local.
- `/admin` abre o Adimin. Use a conta simulada e depois o e-mail e a senha configurados para o painel.

## Hospedagem

O GitHub pode guardar o código. A aplicação roda em um Worker com banco Cloudflare D1, arquivos em R2 e a autenticação do ChatGPT Sites. Para hospedar no Sites, registre um projeto próprio, mantenha os bindings `DB` e `BUCKET`, aplique as migrações e configure os segredos desse ambiente.

| Configuração | Valor |
| --- | --- |
| `VITRINE_MASTER_EMAIL` | E-mail da conta autorizada pela hospedagem a abrir o painel administrativo |
| `VITRINE_MASTER_LOGIN_EMAIL` | E-mail usado no formulário do Adimin |
| `VITRINE_MASTER_PASSWORD_VERIFIER` | Verificador PBKDF2 gerado pelo script de configuração |
| `VITRINE_MASTER_SESSION_KEY` | Chave aleatória gerada pelo script de configuração |

Execute o script em um ambiente separado para gerar os valores de produção e cadastre-os no gerenciador de segredos da hospedagem.

