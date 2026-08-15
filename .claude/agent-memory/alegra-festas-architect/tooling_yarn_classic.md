---
name: tooling_yarn_classic
description: alegra_frontend usa Yarn Classic 1.22.x, não Yarn Berry, apesar da preferência padrão do persona
metadata:
  type: project
---

O `alegra_frontend` roda **Yarn Classic 1.22.22** (`yarn -v` no ambiente
confirma), não Yarn Berry — não há `.yarnrc.yml` nem campo
`packageManager` no `package.json` indicando Berry. O persona/system
prompt deste projeto pede "Yarn Modern (Berry)" como diretriz padrão, mas
o código real (rounds 1-5 já commitados) foi todo construído com Classic.

**Por quê importa**: `yarn install --frozen-lockfile` é sintaxe do
Classic; o Berry usa `--immutable` e rejeita `--frozen-lockfile` com erro.
Se algum dia rodar `corepack enable` num Dockerfile/CI sem
`packageManager` no package.json, o Corepack tende a resolver para o Yarn
estável mais recente (Berry) e quebra comandos existentes.

**Como aplicar**: em qualquer Dockerfile/CI deste projeto, não rodar
`corepack enable` nem instalar Yarn via npm sem pin de versão. A imagem
`node:22-alpine` já traz Yarn Classic 1.22.22 pré-instalado em
`/usr/local/bin/yarn` (symlink para `/opt/yarn-v1.22.22`) — nenhuma
instalação extra é necessária nela. `npm install --global yarn@1.22.22`
nessa imagem falha com `EEXIST` porque o binário já existe.

Ver [[docker_frontend_setup]] para o Dockerfile de produção que usa isso.
