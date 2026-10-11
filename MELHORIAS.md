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
