# MELHORIAS — youtube-automation-agent

## Revisão de segurança — 2026-10-11

### SEC-02 · Arquivos locais de credenciais · [P0]

- **Arquivos:** `utils/credential-manager.js`, `config/credentials.json`, `config/tokens.json`
- **Evidência:** o `tokens.json` local estava com modo `0644`; as gravações não definiam permissões e podiam deixar JSON parcial em uma interrupção.
- **Mudança:** criar o diretório de credenciais com `0700`, restringir os arquivos a `0600` em POSIX e salvar JSON por arquivo temporário privado seguido de rename atômico. `CREDENTIALS_DIR` continua selecionando a pasta por instância.
- **Aceite:** tokens e chaves não ficam legíveis para outros usuários locais; JSON inválido não é substituído silenciosamente por objeto vazio.
- **Estado:** implementado. O `tokens.json` local foi restrito a `0600`; credenciais continuam em JSON sem criptografia em repouso.
- **Verificação estática:** `node --check utils/credential-manager.js`; `stat -c '%a %n' config/credentials.json config/tokens.json`.

### BUG-01 · Fluxo OAuth manual não completava o callback · [P0]

- **Arquivo:** `utils/credential-manager.js:setupYouTubeCredentials()`
- **Evidência:** o assistente exibia uma URL com redirect local e pedia um código manual, sem um servidor callback compatível com OAuth Desktop.
- **Mudança:** usar `@google-cloud/local-auth` com callback loopback efêmero; gerar o JSON temporário de cliente dentro da pasta privada e removê-lo ao concluir ou falhar.
- **Aceite:** o usuário autoriza no navegador e os tokens são salvos com modo privado.
- **Estado:** código implementado; autorização real não foi exercitada sem consentimento e conta Google.
- **Verificação estática:** `node --check utils/credential-manager.js`; `rg -n 'authenticate\(|run_console|getToken\(code\)' utils/credential-manager.js`.

### Limites não alterados nesta rodada

- Os escopos OAuth cobrem upload, gerenciamento, leitura e analytics porque o produto usa essas ações; redução por função exige mapear e validar cada endpoint.
- Não foram adicionados nem executados testes nesta rodada.

## Revisão de produção — 2026-10-11

### SEC-03 · Fontes de imagem do renderer · [P1]

- **Arquivo:** `utils/hyperframes-video-renderer.js`
- **Risco:** buscar URLs arbitrárias permitia SSRF e a leitura de caminhos locais não tinha limite de tamanho nem confinamento ao projeto.
- **Mudança:** aceitar apenas data URIs base64 JPEG/PNG/WebP ou arquivos locais dentro da raiz real do projeto; limitar cada imagem a 20 MiB e a composição a 180 MiB; remover o fetch HTTP.
- **Estado:** implementado. Chamadores atuais usam data URIs ou imagens do projeto.

### BUG-02 · Exclusão através de symlink · [P1]

- **Arquivos:** `utils/disk-cleanup.js`, `scripts/channel-scheduler.js`
- **Risco:** limites lexicais não impediam que uma raiz de mídia redirecionada por symlink levasse a exclusão para fora da pasta gerenciada.
- **Mudança:** confirmar caminhos reais e arquivos regulares antes de apagar ou reenviar; aceitar somente MP4s e imagens suportadas nas rotinas correspondentes.
- **Estado:** implementado.

### BUG-03 · Preservação do ledger · [P1]

- **Arquivo:** `utils/topic-ledger.js`
- **Risco:** qualquer erro de leitura ou JSON inválido era tratado como ledger vazio, permitindo sobrescrever o histórico.
- **Mudança:** iniciar um ledger somente quando o arquivo não existe; leitores de pauta e scheduler também falham de forma explícita diante de JSON inválido; fila inválida impede a retomada. Atualizações inválidas não escrevem e o temporário usa modo privado e criação exclusiva.
- **Estado:** implementado.

### BUG-04 · Retry de Shorts após cota · [P1]

- **Arquivos:** `scripts/channel-scheduler.js`, `scripts/upload-to-socials.js`
- **Risco:** o retry publicava somente o vídeo longo; Shorts pulados ou com erro ficavam pendentes sem novo envio.
- **Mudança:** o worker agora encontra pendências de vídeo longo ou Shorts e reenvia somente os Shorts ainda não confirmados, um vídeo por ciclo.
- **Estado:** implementado; execução real depende de credenciais e cota do canal.

### BUG-05 · Limpeza por artefato publicado · [P1]

- **Arquivos:** `utils/publication-status.js`, `utils/disk-cleanup.js`, `scripts/channel-scheduler.js`
- **Risco:** uma falha em um corte bloqueava a limpeza do master e de todos os outros cortes publicados.
- **Mudança:** apagar o master após confirmação do YouTube e dos destinos de vídeo longo ativos; apagar cada corte somente após seus próprios destinos exigidos; preservar arquivos com estado falho ou desconhecido. Limpeza periódica mantém o período de carência configurado.
- **Estado:** implementado.

### BUG-06 · Dependências reproduzíveis do renderer · [P1]

- **Arquivos:** `package.json`, `README.md`, `experiments/hyperframes-pulso-pilot/package-lock.json`
- **Risco:** um clone limpo instalava as dependências principais, mas não o runtime isolado usado pelo renderer HyperFrames.
- **Mudança:** adicionar `npm run setup:hyperframes` e documentar o passo no Quick start e no troubleshooting.
- **Estado:** implementado.

### BUG-07 · Contagem de fontes independentes · [P2]

- **Arquivo:** `utils/news-hunter.js`
- **Risco:** ao acrescentar feeds brasileiros como confirmação, a quantidade original de veículos do Google News era extraída do rótulo de exibição e contada como uma única fonte.
- **Mudança:** manter os nomes dos veículos em uma lista de origem e calcular a quantidade distinta sem interpretar texto de apresentação.
- **Estado:** implementado.

## Reauditoria de dependências e qualidade — 2026-10-11

### DEVOPS-01 · Dependências vulneráveis e lint sem execução confiável · [P1]

- **Arquivos:** `package.json`, `package-lock.json`, `README.md`, `.github/workflows/ci.yml`, `eslint.config.js`
- **Evidência:** a auditoria inicial encontrou 29 avisos na árvore de produção (2 críticos, 16 altos, 9 moderados e 2 baixos). O lint falhava em módulos ESM, APIs globais do Node e dois blocos vazios; também percorria skills vendorizadas e bundle local do piloto.
- **Mudança:** atualizei patches compatíveis no lock, subi `sqlite3` para 6.0.1 e `sharp` para 0.35.5, removi `nodemon` sem uso, declarei Node 22+ e matriz CI Node 22/24 em Ubuntu 24.04. A CI agora exige leitura mínima e bloqueia advisories altos/críticos. Corrigi os erros de lint e as regras de escopo ESM.
- **Resultado:** `npm audit --omit=dev --audit-level=high` passou; auditoria total tem zero altos/críticos e três moderados por UUID transitivo. A inspeção estática dos consumidores mostra uso de `uuid.v4()` sem buffer em `node-cron`; `gaxios` não chama UUID no código instalado. O advisory cobre `v3/v5/v6` ao escrever em buffers externos ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq)). Não forcei override fora da faixa nem atualização major do `node-cron` sem validação. `sharp` e `tar` foram elevados além das versões afetadas ([sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w), [tar](https://github.com/advisories/GHSA-r292-9mhp-454m)). `sqlite3` 6.0.1 é a última versão publicada, mas o repositório foi arquivado; planejar migração futura para um driver mantido.
- **Validação local:** `npm run lint` passou com zero erros e quatro avisos de variáveis sem uso; `node --check` nos módulos alterados e `git diff --check` passaram.
- **Limite operacional:** o `node_modules` atual ainda contém `sqlite3` 5.1.7 e `sharp` 0.33.5; não reinstalei dependências nem reiniciei o scheduler ativo. Aplicar o novo lock requer implantação controlada em Node 22+.
- **Testes/CI:** não executei testes. A CI remota não foi acionada porque seu workflow executa a suíte; a mudança foi preparada para publicar com `[skip ci]`.

## SEC-01 · TLS & Transport Security
- Enforce HTTPS for all YouTube API calls
- Disable insecure transport layers
- Use certificate pinning where appropriate

## SEC-02 · Authentication & Authorization
- Implement OAuth2 for YouTube API access
- Secure credentials storage (environment variables, vault)
- Role-based access control for different automation levels

## SEC-03 · Input Validation & Sanitization
- Validate all YouTube API request parameters
- Sanitize channel/playlist identifiers
- Prevent injection attacks in API calls

## SEC-04 · Error Handling & Resilience
- Graceful degradation when YouTube API is unavailable
- Retry logic with exponential backoff
- Clear error messages for clients

## SEC-05 · Monitoring & Observability
- Log all API calls with structured logging
- Track latency and error rates
- Set up alerts for anomaly detection

## IMP-01 · Test Coverage
- Unit tests for authentication flows
- Integration tests for YouTube API interactions
- Mock external services for isolation

## IMP-02 · Documentation
- Update API documentation with security notes
- Maintain changelog for security changes
- Create runbooks for operational tasks

## IMP-03 · Performance
- Optimize YouTube API pagination
- Cache frequently accessed video metadata
- Parallelize independent API calls

## IMP-04 · Compliance
- Ensure compliance with YouTube Terms of Service
- Respect rate limits and quota policies
- Implement data retention policies

## IMP-05 · Backup & Recovery
- Persist critical configurations safely
- Backup credentials (encrypted)
- Test disaster recovery procedures

## IMP-06 · Dependency Management
- Pin YouTube client library versions
- Regular security scanning of dependencies
- Update outdated packages

## IMP-07 · Incident Response
- Procedure for YouTube API outages
- Incident communication plan
- Post-incident review process

## IMP-08 · Access Control
- Restrict automated access to authorized accounts
- Implement approval workflows for sensitive actions
- Audit logging for all automation actions

## IMP-09 · Third-Party Risk
- Review YouTube API terms and conditions
- Manage external service dependencies
- Monitor for API changes affecting security

## IMP-10 · Future Roadmap
- Add support for additional platforms
- Improve error handling for API changes
- Enhance security headers and monitoring
