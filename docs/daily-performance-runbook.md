# Coleta diária de desempenho — Pulso

A coleta usa o ledger da produção animada e o caminho estrito do agente de analytics existente. Somente publicações confirmadas entram no inventário. Um estado de upload em andamento/falha aparece no resumo operacional, sem virar post confirmado.

## Executar e consultar

    npm run analytics:daily

O snapshot canônico é data/reports/performance/AAAA-MM-DD.json. O arquivo Markdown de mesmo nome é derivado e pode ser reconstruído sem nova consulta. O dia da agenda usa America/Sao_Paulo. A unidade ai-video-performance.timer executa às 09:00 BRT, com recuperação após desligamento. O processo não gera vídeos, não publica, não usa IA nem abre login.

Repetir no mesmo dia reutiliza o snapshot, protegido por lock com PID vivo. Para coletar novamente depois de renovar credenciais ou corrigir uma integração:

    npm run analytics:daily -- --refresh

O refresh arquiva o JSON anterior em history/ antes de substituir o snapshot daquele dia. Arquivos usam modo 0600. Um ledger/relatório ilegível falha sem apagar evidências.

O processo termina com código 2 quando existem posts confirmados e nenhuma métrica pode ser coletada. O relatório permanece gravado com status blocked e o serviço fica failed para tornar o bloqueio visível. Código 1 representa falha de execução/estado. Dados parciais são identificados no relatório; nenhum desses estados habilita publicação ou aprendizado automaticamente.

## O que é medido

YouTube e Shorts usam a identidade do canal autenticado, validam a propriedade de cada vídeo e coletam contadores públicos observados via Data API e relatórios diários via Analytics API. O agente reaproveita CredentialManager; não há alteração de tokens/configuração durante a coleta. O scope yt-analytics.readonly é necessário. A integração consulta os últimos 30 dias até ontem no fuso America/Los_Angeles, usado pelos relatórios do YouTube; a data efetivamente devolvida aparece como availableThrough. Atraso da API não vira zero.

Os campos views, engagedViews, estimatedMinutesWatched, averageViewDuration, averageViewPercentage, likes, comments, shares, subscribersGained e subscribersLost seguem o relatório oficial por dia. Impressions/CTR não são presumidos nesse endpoint. Sem permissão de analytics, os contadores públicos já observados permanecem como dados parciais. OAuth inválido interrompe consultas da conta e é registrado como bloqueio; não há fallback simulado.

Os deltas de views/likes/comments exigem duas observações reais da mesma conta, com intervalo positivo de até 48 horas. Se o snapshot do dia anterior faltar, a coleta busca a observação válida mais recente entre os sete snapshots anteriores e só aceita o intervalo real de até 48 horas. O relatório informa as horas exatas e uma taxa descritiva por 24 horas (sem interpolar contadores); correções negativas da plataforma são preservadas. O painel ordena pela taxa observada, mostra views cumulativas separadamente e não chama a taxa de projeção. Quando a API fornece, o painel mostra idade real do post e duração para comparar conteúdo de faixa semelhante. A data de publicação vem da API, nunca da data de geração do arquivo. Os rankings separam longos e Shorts; nenhum resultado muda o scheduler ou recomenda um formato como comprovadamente vencedor.

Cada plataforma também registra no snapshot a última publicação confirmada e o estado/código do envio não resolvido mais recente. O dashboard mostra a idade da última confirmação e tentativas `unknown`/falhas sem convertê-las em publicação ou em meta de cadência. Horário de postagem esperado continua dependente da decisão YAI-021.

Kwai, TikTok, Instagram, X e Telegram têm a cobertura declarada. Se houver post confirmado e faltar coletor oficial, o relatório registra official_collector_unavailable. Ausência de API/permissão permanece uma pendência real, sem simular contadores. Integrações e validação de pelo menos sete dias continuam abertas no plan.md.

## Relação com o painel

Os relatórios diários são um histórico distinto das amostras 24h/7d/rolling do painel. O caminho estrito usa as mesmas credenciais, não injeta linhas incompletas no ChannelLearningEngine e não usa simulações. O endpoint protegido `GET /api/daily-performance` lê até 14 snapshots canônicos em modo somente leitura; não inicia coleta. O painel Analytics exibe status/frescor, rede, vídeo, formato, views/deltas, taxa observada e retenção disponível, além da última confirmação e de tentativa incerta por destino. Caminhos locais e hashes não são enviados ao browser. OAuth inválido e ausência de coletor Kwai continuam visíveis como bloqueios, sem métricas fabricadas.

Na projeção do browser, contadores de snapshots antigos sem `source: youtube_official_apis` não são tratados como observados: ficam ocultos, o post/status recebe `unverified` e o agregado passa a `partial` quando necessário. Os JSON antigos são preservados para auditoria; não são regravados nem eliminados.

## Verificação

    node --test tests/daily-performance.test.js tests/android-device-lock.test.js
    npm run lint
    npm run test:ci

As fixtures cobrem origem e atraso das métricas, zero versus ausente, conta divergente, erro de permissão, OAuth inválido, dedupe, concorrência, arquivo corrompido, refresh com histórico e deltas negativos. A validação de conta real e observação de sete dias não são substituídas por fixtures.

Fontes: [relatórios de canal](https://developers.google.com/youtube/analytics/channel_reports), [definições das métricas](https://developers.google.com/youtube/analytics/metrics), [consulta e disponibilidade de dados](https://developers.google.com/youtube/analytics/reference/reports/query).
