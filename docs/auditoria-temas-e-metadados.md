# Auditoria estática de fontes e metadados por tema

**Data:** 13/10/2026. **Escopo:** configuração local, seleção do `news-hunter`, prompts, fallbacks de metadados e uma checagem HTTP somente de leitura. O resultado ao vivo abaixo é uma fotografia pontual, limitada a uma amostra de até 65.536 bytes por URL; não comprova disponibilidade futura, qualidade editorial nem licenças.

## Inventário de `config/themes.json`

Todos os dez temas estão `enabled`, têm query de Google News, hashtags e persona com PT-BR. Reddit entra como conteúdo comunitário, não como confirmação factual. `RSS` lista feeds configurados, não feeds testados.

| ID | Tema / marca de watermark | Google News | RSS configurado | Reddit | Filtro local |
|---|---|---|---|---:|---|
| `ia` | Inteligência Artificial / Pulso IA | `inteligência artificial` | 8: G1 Tecnologia, TecMundo, Canaltech, Olhar Digital, BBC Technology, TechCrunch AI, Wired AI, MIT Tech Review | 6 | Presente |
| `curiosidades` | Curiosidades insanas / Pulso Curiosidades | `fato curioso OR descoberta surpreendente` | 1: BBC Offbeat | 5 | Vazio; depende da query e deduplicação |
| `dinheiro` | Dinheiro dos Ricos & Economia Bizarra / Pulso Dinheiro | `bilionário OR economia mercado` | 1: BBC Business | 3 | Presente |
| `saude` | Saúde & Bem-estar Surpreendente / Pulso Saúde | `saúde estudo OR emagrecimento OR ansiedade OR sono` | 1: ScienceDaily Health | 5 | Presente |
| `economize` | Economize dinheiro / Pulso Economia | `economizar dinheiro OR dica gasto` | 0 | 4 | Presente |
| `psicologia` | Psicologia & Mente Humana / Pulso Mente | `psicologia OR estudo comportamento` | 1: PsyPost | 3 | Presente |
| `relacionamentos` | Psicologia dos Relacionamentos / Pulso Relações | `relacionamento amoroso OR psicologia atração` | 1: PsyPost | 3 | Presente |
| `fitness` | Fitness & Treino Surpreendente / Pulso Fitness | `treino OR emagrecimento OR dieta fitness OR exercício` | 1: ScienceDaily Health | 5 | Presente |
| `misterios` | Mistérios sem solução / Pulso Mistérios | `mistério inexplicado OR desaparecimento` | 0 | 4 | Vazio; depende da query e deduplicação |
| `carreira` | Carreira & Sucesso Profissional / Pulso Carreira | `carreira OR emprego OR entrevista emprego OR mercado de trabalho` | 1: BBC Work | 4 | Presente |

`useHn` só está ligado em `ia`. Saúde/fitness, dinheiro/economize e psicologia/relacionamentos têm sobreposição de fonte ou assunto; exigem revisão factual e deduplicação editorial. `economize` e `misterios` não têm feed RSS. Não há fonte brasileira oficial de vagas configurada para `carreira`.

## Uso real dos metadados no código

- `theme.persona` informa o prompt do roteiro e do SEO; as personas descrevem português do Brasil.
- `theme.brand` vira `script.channel` e watermark do vídeo. O objeto não roteia para uma conta real por tema.
- `utils/news-hunter.js` mistura Google News, Reddit e feeds configurados. Para uma pauta reaparecida no Google News e no RSS, o reforço de “segunda fonte” agora normaliza o rótulo do veículo e conta a mesma publicação uma vez; a URL do `<source>` também fica disponível para identidade quando o rótulo não basta. Isso reduz uma forma de dupla contagem, mas não detecta republicação/sindicação entre marcas distintas.
- SEO tenta gerar hashtags dinamicamente; quando falha ou retorna vazio, os uploaders agora usam `theme.hashtags` por meio de `utils/theme-metadata.js`. Os caminhos de vídeo longo, Shorts e retentativa social preservam hashtags específicas de SEO, usam tags derivadas do tema no fallback e não acrescentam hashtags genéricas de IA ao caption. O fallback de descrição do caminho YouTube também usa marca e nome do tema, salvo `CHANNEL_DESCRIPTION` explícita.
- `CHANNEL_DESCRIPTION` e `CHANNEL_NAME` são globais. Os parâmetros de voz também são globais; não existe `voice` por tema em `themes.json`.
- O comentário de `themes.json` diz que um tema só deve ser habilitado quando suas contas estiverem ligadas, mas as dez entradas estão habilitadas. No roteamento analisado, não há mapa de contas por tema. Esta contradição não autoriza criar contas, desativar temas ou alterar identidade durante uma produção ativa.

## Riscos e recomendações

1. **Metadados fora do assunto:** corrigido localmente. `tests/theme-metadata.test.js` percorre os dez temas, confere hashtags, tags e descrição, e valida que a retentativa de um tema fitness não injeta tags de IA. SEO específico permanece prioritário.
2. **Risco editorial em saúde/finanças:** tratar Reddit, PsyPost e agregadores como descoberta; exigir fonte primária ou órgão reconhecido na checagem factual antes de narrar alegações de saúde/investimento.
3. **Cobertura local:** avaliar feeds oficiais brasileiros de vagas e fontes primárias por tema; manter a lista atual até validar cada endpoint.
4. **Routing e habilitação:** decidir se dez temas compartilham uma conta por rede ou se existirão canais separados. Só depois alinhar `enabled`, marcas e integração do uploader com a decisão de YAI-019.
5. **Validação de feeds:** o check datado de URL/status/idioma e as fixtures offline existem após IMP-48. Manter execução manual e não converter falha temporária em troca automática sem rastreio.

O inventário de temas e feeds configurados é estático. IMP-48 verificou as URLs atuais em uma consulta read-only, mas não alterou prompt, destino, conta ou feed e não acionou upload. O código consome o fallback de hashtags/tags configurado por tema; a escolha de substituições, fontes primárias por tema, política de idioma/tradução, roteamento das contas e decisão de temas ativos continuam pendentes.

## Implementação local — 13/10/2026, 18h31 (-03)

`utils/theme-metadata.js` centraliza a seleção segura do tema, o fallback para `ia` quando o identificador não existe, a resolução de hashtags/tags e a descrição da marca. `scripts/channel-scheduler.js`, `scripts/upload-to-socials.js` e `utils/social-retry.js` usam esse contrato tanto no envio inicial quanto nas retentativas. Hashtags produzidas pelo SEO continuam com precedência.

Validação: `eslint` nos cinco arquivos modificados passou sem avisos; `node --test tests/theme-metadata.test.js tests/social-retry.test.js` passou 5/5 e a suíte regressiva selecionada (`tests/theme-metadata.test.js`, `tests/social-retry.test.js`, `tests/upload-social-android-routing.test.js`, `tests/kwai-upload-flow.test.js` e `tests/publication-status-full-x.test.js`) passou 11/11. A fixture percorre os dez registros, valida query/feeds configurados e uma retentativa social sintética; não envia mídia nem verifica a qualidade/disponibilidade dos feeds RSS. O runner emitiu um aviso existente de depreciação do módulo `punycode`, sem falha.

## Checagem HTTP somente de leitura — 13/10/2026, 18h44 (-03)

O utilitário `scripts/audit-theme-feeds.js` consultou as 13 URLs únicas presentes na configuração, sem autenticação, gravação, publicação ou substituição automática. A resposta foi amostrada com limite de 65.536 bytes e timeout de 8 s; `206 Partial Content` conta como feed válido se a amostra contém RSS/Atom. O relatório integral, incluindo URL, cabeçalhos e datas dos itens, está em [`docs/evidencias/theme-feeds-2026-10-13.json`](evidencias/theme-feeds-2026-10-13.json). Nessa execução, 10/13 retornaram XML válido, duas responderam HTTP 404 e uma respondeu HTTP 204 sem corpo. O comando retorna código 1 quando encontra qualquer feed com falha; nesse caso, o código 1 registra as três falhas esperadas, não uma falha do próprio auditor.

| Fonte configurada | Tema(s) | Resultado observado | Idioma declarado / observação |
|---|---|---|---|
| Canaltech | `ia` | XML, HTTP 200 | `pt-br` |
| BBC Business | `dinheiro` | XML, HTTP 200 | `en-gb`; título do canal é genérico (`BBC News`) |
| BBC Offbeat | `curiosidades` | HTTP 404 | Feed configurado não disponível nesta consulta |
| BBC Work | `carreira` | XML, HTTP 200 | `en-gb`, mas o feed é geral (`BBC News`), não comprova cobertura de carreira |
| BBC Technology | `ia` | XML, HTTP 200 | `en-gb` |
| G1 Tecnologia | `ia` | XML, HTTP 206 | `pt-BR`; resposta parcial compatível com o cabeçalho Range |
| Olhar Digital | `ia` | XML, HTTP 200 | `pt-BR` |
| TechCrunch AI | `ia` | XML, HTTP 200 | `en-US` |
| PsyPost | `psicologia`, `relacionamentos` | XML, HTTP 200 | `en-US`; mesma fonte para os dois temas |
| ScienceDaily Health | `saude`, `fitness` | HTTP 404 | URL configurada falhou nesta consulta |
| MIT Tech Review | `ia` | XML, HTTP 200 | `en-US` |
| TecMundo | `ia` | HTTP 204, sem corpo | `/rss` não entregou feed nesta consulta |
| Wired AI | `ia` | XML, HTTP 200 | `en-US` |

Como alternativa candidata para ScienceDaily, a página oficial de [RSS Newsfeeds](https://www.sciencedaily.com/newsfeeds.htm) lista `https://www.sciencedaily.com/rss/top/health.xml`; uma checagem pontual dessa URL retornou XML HTTP 200 e idioma `en-us`. Ela ainda precisa ser confirmada e incorporada em janela segura. As tentativas de URLs do TecMundo em `/rss/novidades` também retornaram HTTP 204; nenhuma substituição foi comprovada. A fonte da BBC marcada como “Work” aponta para o feed geral, portanto não deve ser tratada como fonte de carreira só por ter XML válido. A documentação pública da [BBC Developer News Feeds](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm) encontrada é antiga e não confirmou um endpoint atual e específico para curiosidades ou carreira.

**Decisão:** manter a configuração operacional sem alterações. O scheduler e a geração automatizada estavam ativos; não trocar ou desabilitar feeds durante a execução. Antes de aplicar alterações, validar fontes substitutas para `curiosidades`, `saude`/`fitness`, `carreira` e `ia` em sessão ociosa e revisar se a operação aceita conteúdo em inglês ou requer tradução. A checagem técnica não substitui curadoria editorial nem validação de licença.

Validação desta implementação: `eslint utils/theme-feed-audit.js scripts/audit-theme-feeds.js tests/theme-feed-audit.test.js` passou; `node --test tests/theme-feed-audit.test.js tests/theme-metadata.test.js` passou 6/6; `node --check` nos três arquivos passou. Os testes usam respostas locais simuladas e não repetem a amostragem de produção.

## Implementação local — 13/10/2026, 18h55–18h57 (-03)

IMP-50 corrige a contagem de fontes em `utils/news-hunter.js`. O parser do Google News preserva o URL e o nome no elemento `<source>`; a identidade local remove rótulos de seção como “Technology”, “Work” e “Business”, de modo que `BBC Work` e `BBC News` contam como BBC. O hunter só concede o bônus de corroboração de 0,8 quando um feed tem identidade distinta e o título tem sobreposição suficiente. Também renomeei a função interna de `fetchBrazilianRss` para `fetchThemeFeeds`, pois a configuração contém fontes de vários idiomas e países.

Cinco fixtures cobrem decodificação XML e URL do publisher, aliases de marca, publisher repetido, publisher realmente distinto e rótulo correto do sinal no log. O gerador agora distingue “fontes independentes” de “comentários” ao explicar a candidata. A regressão combinada `node --test tests/news-hunter.test.js tests/theme-feed-audit.test.js tests/theme-metadata.test.js` passou 11/11; lint direcionado e `node --check` passaram. Esta heurística não detecta conteúdo sindicado entre marcas diferentes, e a sessão não chamou feeds/Google News ao vivo nem alterou configuração.


## Rechecagem de feeds candidatos — 13/10/2026, 22h26 BRT (IMP-20261014-06)

A rechecagem read-only consultou cinco URLs com `Range` de no máximo 8.192 bytes, timeout de 8 s e concorrência 2. O relatório bruto está em [`theme-feeds-candidate-recheck-2026-10-14.json`](evidencias/theme-feeds-candidate-recheck-2026-10-14.json).

| Feed | Estado observado | Metadados | Resultado para configuração |
|---|---|---|---|
| `https://www.sciencedaily.com/rss/top/health.xml` | HTTP 206; XML válido | `Top Health News -- ScienceDaily`, `en-us` | Candidato técnico para saúde/fitness; não aprovado para roteiro/publicação. |
| `https://www.sciencedaily.com/rss/strange_offbeat.xml` | HTTP 206; XML válido | `Strange & Offbeat News -- ScienceDaily`, `en-us` | Candidato técnico para curiosidades; não aprovado para roteiro/publicação. |
| ScienceDaily `.../rss/top/health_medicine.xml` já configurado | HTTP 404 | — | Falha persistente nessa consulta. |
| BBC Offbeat já configurado | HTTP 404 | — | Falha persistente nessa consulta. |
| TecMundo `/rss/` já configurado | HTTP 204, sem corpo | — | Sem feed XML nesta consulta. |

A [página oficial de feeds do ScienceDaily](https://www.sciencedaily.com/newsfeeds.htm) lista os dois endpoints candidatos, mas os [termos do serviço](https://www.sciencedaily.com/terms.htm) dizem que o RSS fornece headlines/resumos conforme publicados, proíbem modificar texto/conteúdo/links, requerem atribuição e link direto, limitam o armazenamento e vedam inserir conteúdo do feed em uma base sem consentimento prévio por escrito. O pipeline gera roteiro adaptado e mantém ledger/cache, então disponibilidade XML não basta para autorizar seu uso. A [página de RSS do Gov.br](https://www.gov.br/pt-br/rss) declara licença CC BY-ND 3.0, que não é aprovação para conteúdo adaptado. A [lista BBC consultada](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm) se declara incompleta e tem rodapé de 2004–2011; não serve como comprovação de feed atual de carreira. Para a NASA, foram consultadas a [lista de feeds](https://www.nasa.gov/rss-feeds/) e a [orientação de uso de mídia](https://www.nasa.gov/nasa-brand-center/images-and-media/?linkId=112714229); elas não foram tratadas como autorização para roteiro derivado. As referências e limites estão registrados em `.planning/2026-10-12-concluir-melhorias-pulso/findings.md`.

**Decisão operacional:** nenhum endpoint foi substituído, desativado ou adicionado a `config/themes.json`. Permanecem pendentes a curadoria de uma fonte com termos compatíveis com roteiro derivado e o posicionamento sobre idioma/tradução. Usar RSS somente como feed publicado exatamente como fornecido exigiria outro fluxo, atribuição e retenção próprios; essa integração não faz parte do comportamento atual do gerador.

### Candidatos brasileiros para economia e saúde — 13/10/2026, 22h31 BRT (IMP-20261014-08)

A página oficial [RSS da Agência Brasil](https://agenciabrasil.ebc.com.br/feed/) lista editorias separadas de Economia e Saúde. O auditor read-only recebeu 206/XML (`application/rss+xml`, `pt-br`) nas duas URLs: [`https://agenciabrasil.ebc.com.br/rss/economia/feed.xml`](https://agenciabrasil.ebc.com.br/rss/economia/feed.xml) e [`https://agenciabrasil.ebc.com.br/rss/saude/feed.xml`](https://agenciabrasil.ebc.com.br/rss/saude/feed.xml). A amostra ficou limitada a 8.192 bytes por feed e o relatório está em [`ebc-theme-feed-candidates-2026-10-14.json`](evidencias/ebc-theme-feed-candidates-2026-10-14.json).

A [Carta de Serviços da Agência Brasil](https://www.gov.br/pt-br/servicos/acessar-noticias-em-tempo-real-gratuitamente?id=10223&origem=servico) diz que conteúdo jornalístico da EBC pode ser reproduzido em outros sites e veículos com crédito, mas exclui material de agências parceiras internacionais sem autorização. A página não resolve expressamente se a licença cobre roteiro derivado, tradução/narração e armazenamento do ledger/cache do Pulso; esses dois feeds são candidatos técnicos em português, não uma aprovação de uso na produção. O filtro de conteúdo parceiro e a compatibilidade dos derivados precisam de confirmação antes de mudar a configuração.

A lista oficial de [RSS da NASA](https://www.nasa.gov/rss-feeds/) inclui notícias e tecnologia; a orientação atual de [uso de imagens e mídia](https://www.nasa.gov/nasa-brand-center/images-and-media/?linkId=112714229) afirma que saídas de IA devem ser atribuídas ao próprio produto de IA e veda expressões como “according to NASA” em produtos gerados por IA. Isso conflita com atribuição editorial direta à NASA no formato atual do Pulso; não foi encontrado nem testado um endpoint RSS específico nesta rechecagem. NASA permanece referência de pesquisa, não feed aprovado.

**Estado:** `config/themes.json` permanece sem alterações. A descoberta reduz a lacuna técnica de cobertura em português para economia e saúde, mas não fecha YAI-020 nem autoriza ingestão/publicação.

## Rechecagem read-only — 15/10/2026, 18h41 BRT

Reexecutei `auditThemeFeeds` sobre as 13 URLs de `config/themes.json`, com timeout de 8 s, amostra limitada a 8 KiB por feed e concorrência 2. O relatório marcou `readOnly=true`: **10/13 feeds** retornaram XML RSS/Atom válido. BBC Offbeat e ScienceDaily Health responderam HTTP 404; TecMundo respondeu HTTP 204 sem corpo. São as mesmas três falhas da fotografia de 13/10. Não foram alterados feeds nem temas. O estado HTTP é momentâneo e a disponibilidade técnica não aprova direitos de adaptação, retenção, idioma ou pertinência editorial; manter os gates de YAI-019/020.

## Rechecagem read-only — 17/10/2026, 13:45 BRT

`node scripts/audit-theme-feeds.js` consultou as 14 URLs únicas da configuração atual, sem credenciais, com amostra máxima de 65.536 bytes. O resultado foi **14/14 XML RSS/Atom válidos**, estados HTTP 200 ou 206; relatório integral, URL, veículo, tema, idioma declarado e data mais recente observada estão em [`docs/evidencias/theme-feeds-2026-10-17.json`](evidencias/theme-feeds-2026-10-17.json). Não houve escrita/alteração nos feeds, uso de artigos, publicação ou login.

O inventário mostra quatro feeds declarando `pt-BR` (Canaltech, G1 Tecnologia, Olhar Digital e Tecnoblog) e dez feeds em inglês. Há uma URL geral da BBC sob o rótulo `BBC Work` (o channel title é `BBC News`, sem comprovar foco de carreira), uma instância de PsyPost para Psicologia e Relacionamentos e a mesma ScienceDaily Health para Saúde e Fitness. Economize dinheiro e Mistérios não têm RSS na configuração. Tecnoblog retornou XML válido, mas sem data de item reconhecida nesta amostra. Estes fatos descrevem disponibilidade e metadados, não qualidade de pauta, idioma final nem permissão de adaptação/armazenamento.

`node --test tests/theme-feed-audit.test.js tests/theme-metadata.test.js tests/news-hunter.test.js` passou **28/28**. A fixture confirma os metadados configurados para dez temas e a seleção/deduplicação de fontes; não substitui a revisão editorial, licença, idioma ou roteamento por conta. `config/themes.json` não foi alterado. YAI-020 permanece Parcial: o levantamento de direitos de feeds (incluindo termos da ScienceDaily), a política de tradução PT-BR e o mapa real de contas/temas de YAI-019 seguem sem decisão/verificação suficiente.

## Termos oficiais de uso dos feeds — 17/10/2026, 19:58 BRT

Consulta read-only a páginas oficiais dos publishers. Esta matriz registra o alcance que os próprios termos declaram; não é parecer jurídico nem presume uma exceção de copyright. O auditor de 17/10 prova disponibilidade XML de 14/14 endpoints, mas isso não concede licença.

| Feed configurado | Termo/documentação oficial verificada | Compatibilidade aparente com o fluxo atual |
|---|---|---|
| G1 Tecnologia | O diretório oficial da Globo lista uma página específica de Termos do G1, mas ela não abriu nesta consulta; termos de outros produtos Globo não foram usados como substitutos. | **Não comprovada.** Solicitar/ler a licença específica do G1 antes de usar o conteúdo em roteiro derivado. |
| Canaltech | Não localizei uma licença de RSS aplicável. O material editorial do Canaltech sobre copyright explica que reprodução em outro canal costuma exigir crédito e autorização, mas não é uma licença do feed. | **Não comprovada.** Crédito sozinho não autoriza transformação ou uso comercial. |
| Tecnoblog | As páginas oficiais explicam o formato RSS e direitos autorais, sem termos de distribuição/licença do feed encontrados nesta consulta. | **Não comprovada.** Requer confirmação escrita para artigo transformado em vídeo e retenção. |
| Olhar Digital | Os termos oficiais do produto Olhar Digital encontrados concedem uso pessoal/não comercial e exigem permissão escrita para exploração comercial, criação de derivados ou armazenamento fora desse escopo. A página está no domínio de ofertas do publisher, portanto confirmar que se aplica também ao feed editorial principal. | **Não comprovada; potencialmente incompatível.** Obter confirmação de escopo e licença antes de seleção editorial. |
| BBC Technology, Business e News (rótulo local “BBC Work”) | Os Termos de Uso BBC de 19/09/2022 dizem que RSS em website/rede social deve permanecer inalterado e com marca/crédito/link; uso empresarial de RSS exige permissão e pode ter taxa. A página da BBC Developer se declara incompleta e antiga. | **Incompatível sem licença empresarial.** Não usar uma permissão de exibição do feed como autorização para sintetizar, traduzir ou narrar o texto em vídeos. “BBC Work” também continua sendo feed geral, não fonte temática de carreira. |
| TechCrunch AI | Os termos próprios de RSS autorizam exibir o conteúdo fornecido em aplicações, com atribuição e link para o artigo, vedam alteração/remoção dos links e publicidade incorporada ao feed. | **Não cobre o uso atual.** O Pulso usa a URL como descoberta e busca o artigo para roteiro narrado/derivado; falta licença para esse uso. |
| WIRED AI | O acordo de usuário Condé Nast inclui RSS sob as mesmas condições do conteúdo; o direito padrão é pessoal/não comercial e a cópia, tradução, modificação ou obra derivada sem autorização é restringida. | **Incompatível sem autorização comercial escrita.** |
| MIT Technology Review | Os termos oficiais da edição Brasil incluem RSS e restringem scraping, cópia/alteração, derivados e uso comercial; não foi possível confirmar que essa edição é a entidade contratual do feed inglês `technologyreview.com`. O publisher oferece canal de licenciamento. | **Não comprovada para o endpoint configurado.** Pedir autorização ao titular da edição/URL usada; não extrapolar termos de outra edição. |
| OpenAI News | O feed XML responde, mas não localizei termos oficiais específicos que autorizem transformar os artigos do feed em roteiro comercial. Os Termos de Uso da OpenAI são de uso dos Serviços e não constituem licença da redação/news RSS. | **Não comprovada.** Solicitar confirmação ao publisher. |
| ScienceDaily Strange & Offbeat e Health | Os termos específicos de RSS permitem somente os títulos/resumos fornecidos, sem edição, com atribuição “Science Daily” e link funcional. Proíbem publicar texto integral, associar publicidade ao RSS, guardar mais do que cerca de 40 itens e inserir dados do feed em base sem consentimento prévio por escrito. | **Incompatível com o fluxo atual sem licença.** O gerador visita o artigo, extrai contexto para roteiro e mantém registros/cache. Disponibilidade do feed não basta. |
| PsyPost (Psicologia e Relacionamentos) | A página oficial “Terms and Conditions” acessível no domínio do feed mostra o título/rodapé, mas não apresenta cláusulas de licença ou RSS no corpo servido nesta consulta. | **Não comprovada.** Não usar termos de outro site/empresa de nome parecido como substituto. |

**Como o código usa os feeds:** `utils/news-hunter.js` lê até 20 itens por feed, retendo título, link, rótulo/URL de origem e data; não usa descrição RSS desses publishers. `scripts/generate-animated-video.js` então acessa páginas editoriais, e `utils/article-context.js` extrai até 8.000 caracteres de texto contextual. O roteiro, a revisão factual, SEO/arte e fontes passam por esse contexto. O ledger guarda URL, título, hash/contagens de contexto e decisão de revisão, não o bloco bruto de 8.000 caracteres; o cache guarda o roteiro. Logo, uma permissão de mostrar o RSS inalterado, quando existe, não cobre automaticamente leitura/transformação, tradução PT-BR, derivados audiovisuais, imagens, banco/cache ou uso empresarial.

**Ação operacional:** não substituí feeds nem alterei `config/themes.json`, prompts, seleção de pauta ou scheduler. Antes de nova produção depender desses publishers, separar descoberta de fonte licenciada: coletar autorização por escrito para transformação/tradução e retenção aplicáveis ou escolher, validar e registrar fontes com licença explícita compatível. O inglês dos dez feeds continua sem uma política de idioma/tradução formal. Mapeamento de contas e temas de YAI-019 segue pendente. Portanto YAI-020 permanece **PARCIAL** apesar da auditoria técnica e desta matriz.

Referências primárias consultadas: [Termos de uso da BBC (PDF)](https://downloads.bbc.co.uk/usingthebbc/bbc_terms_of_use_19September2022english.pdf), [BBC Developer RSS](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm), [TechCrunch RSS Terms](https://techcrunch.com/rss-terms-of-use/), [Condé Nast User Agreement](https://www.condenast.com/user-agreement), [ScienceDaily Terms](https://www.sciencedaily.com/terms.htm), [MIT Technology Review Brasil — Termos](https://mittechreview.com.br/termos-de-servico/), [MIT Technology Review — Permissions](https://www.technologyreview.jp/about/permissions/), [Olhar Digital — Termos](https://ofertas.olhardigital.com.br/termosdeuso), [Canaltech — copyright](https://canaltech.com.br/juridico/o-que-e-copyright/), [Tecnoblog — RSS](https://tecnoblog.net/sobre/rss/), [Tecnoblog — copyright](https://tecnoblog.net/sobre/copyright/), [PsyPost — Terms and Conditions](https://www.psypost.org/terms-and-conditions/), [lista oficial de sites da Globo com o link de Termos do G1](https://www.globo.com/todos-os-sites/).

## Candidatas com reutilização — 19/10/2026, 12:15 BRT

- **PLOS (candidata, não ativada):** os artigos publicados são CC BY 4.0 ou licença comparável que permite reutilização e adaptação comercial, com atribuição. Validação read-only em 19/10: PLOS One `https://journals.plos.org/plosone/feed/atom` HTTP 200, 30 entradas; PLOS Medicine `https://journals.plos.org/plosmedicine/feed/atom` HTTP 200, 30 entradas; o parser de produção retornou 20 itens com título/link/data para Medicine. `https://journals.plos.org/plosmentalhealth/feed/atom` respondeu 404, portanto esse slug não é endpoint utilizável. O artigo amostral DOI `10.1371/journal.pmed.1005050` respondeu 200 e contém link para CC BY 4.0. Candidatos para triagem são Saúde, Fitness, Psicologia e Curiosidades científicas; feed genérico não substitui filtro temático. Validar licença no artigo individual, manter atribuição/link/licença e sinalizar alterações; imagens e outros materiais de terceiros podem ter direitos diferentes. Referências: [licenças e copyright](https://journals.plos.org/plosone/s/licenses-and-copyright), [instruções RSS](https://journals.plos.org/plosone/s/find-and-read-articles), [termos de uso](https://plos.org/terms-of-use/). Prova de endpoint/parser/DOI em `evidencias/yai-020-plos-atom-integration-2026-10-19.json`.
- **BLS (não aprovada para o fluxo derivado atual):** publica feeds oficiais de emprego/projeções e preços/IPC; declara material editorial em domínio público, exceto fotos/ilustrações. Entretanto, os termos online vedam modificar conteúdo e continuar citando BLS. É candidata para dados/verificação de fatos somente após definir uma forma fiel de uso/atribuição; não foi considerada licença clara para o roteiro derivado atual. Referências: [RSS](https://www.bls.gov/feed/), [copyright](https://www.bls.gov/opub/copyright-information.htm), [termos](https://www.bls.gov/developers/termsOfService.htm). O leitor web não processou o MIME RSS durante a consulta; XML não foi validado nesta rodada.

Nenhum feed, tema ou scheduler foi alterado. YAI-020 continua parcial: confirmar um feed PLOS temático e seu tratamento por item, definir idioma/tradução PT-BR e resolver o mapa de contas/temas antes de alterar a operação.

**Integração Atom do hunter — 19/10/2026, 12:15 BRT:** a falha reproduzida era que o runtime lia somente `<item>` RSS, embora o auditor já aceitasse Atom. `utils/news-hunter.js` foi corrigido para extrair `<entry>`, link `alternate`, título e data; `fetchThemeFeeds` usa o parser compartilhado. Fixture RSS/Atom e regressão combinada passaram 30/30, ESLint passou e o feed PLOS Medicine real produziu 20 itens válidos. Isso fecha a compatibilidade técnica do formato, não aprova o publisher: PLOS continua fora de `config/themes.json` até terminar filtro/licença por item, curadoria e idioma. Evidência read-only em `evidencias/yai-020-plos-atom-integration-2026-10-19.json`.

## Rechecagem técnica de feeds — 19/10/2026, 19:40 BRT

Auditoria somente leitura, com limite de 8 KiB por resposta, timeout de 8 s e concorrência 2: os 14 URLs únicos atualmente configurados retornaram RSS/Atom válido (14/14; HTTP 200 ou 206). Relatório bruto e data por feed: `docs/evidencias/yai-020-feed-audit-2026-10-19.json`. A amostra não comprova adequação temática, atualização de todos os itens (alguns feeds não expuseram data nos primeiros 8 KiB), autorização para roteiro derivado, nem política de tradução.

`economize` e `misterios` continuam sem fonte configurada. O feed `BBC Work` é o feed geral `BBC News`, portanto não confirma cobertura de carreira; PsyPost é compartilhado por Psicologia e Relacionamentos. Dez dos 14 feeds declaram inglês; manter as traduções PT-BR condicionadas à leitura/contexto do artigo e às permissões aplicáveis por item. Nenhuma URL, tema, conta ou scheduler foi alterado. YAI-020 permanece parcial até cobertura/curadoria temática, decisão de idioma e mapa autorizado tema→conta.

## Curadoria PLOS por tema — 19/10/2026, 19:44 BRT

Ampliei candidatos de fonte primária, com leitura da página e licença por artigo, sem ativar feeds nem reutilizar imagens:

| Tema | Candidato e limite editorial |
|---|---|
| IA | [Variação longitudinal em serviços de IA generativa (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0339920): três famílias avaliadas com humanos em dez semanas; famílias sem nomes, sem atribuir deriva a marcas ou causas. |
| Curiosidades | [Abelhas e escassez de pólen (CC0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0338712): colônias privadas de pólen ficaram mais defensivas. “Hangry” é metáfora; não alegar emoção humana. |
| Fitness | [Ensaio de treino resistido com 34 idosos (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0335830): ambos os grupos melhoraram a função física sem diferença significativa entre eles; não virar prescrição nem promessa de emagrecimento. |
| Psicologia | [Exercício e transtornos comuns em estudantes (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0353787): associação prospectiva em estudantes noruegueses; não afirmar prevenção/causalidade. |
| Relacionamentos | [34 medidas de qualidade de relacionamento (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0342451): dois estudos, 3.439 participantes; autorrelato e desenho do questionário limitam a generalização; não dizer que todas as medidas são inválidas. |
| Dinheiro | [Alfabetização financeira digital e consumo familiar (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0357484): dados transversais chineses de 2019; associação não é recomendação de crédito/investimento nem causa comprovada. |
| Carreira | [Idade e recomendação de contratação em trabalho remoto/presencial (CC BY 4.0)](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0340366): três experimentos com cenários; não são contratações reais e não houve efeito significativo de gênero. |

Resumo estruturado, ângulos PT-BR, tags específicas, guardrails e atribuição em `docs/evidencias/yai-020-plos-cross-theme-curation-2026-10-19.json`; a curadoria anterior de Saúde está em `yai-020-plos-health-curation-2026-10-19.json`. A política PLOS permite adaptação comercial de conteúdo sob CC BY com atribuição, mas direitos de figuras e itens de terceiros exigem checagem separada ([termos de licença PLOS](https://journals.plos.org/plosone/s/licenses-and-copyright)). São candidatos editoriais, não autorização de publicação: `economize` e `misterios` seguem sem fixture selecionada; decisão PT-BR/conta por tema e fontes compatíveis com cada feed permanecem pendentes. Nenhum feed foi ativado.

## Curadoria dos temas restantes e política PT-BR — 19/10/2026, 19:50 BRT

A fixture `docs/evidencias/yai-020-plos-cross-theme-curation-2026-10-19.json` agora contém candidatos individualmente licenciados para os dez temas configurados, incluindo os dois que não tinham feed: `economize` (experimento com 708 adultos dos EUA sobre custo informado de energia em standby; mediu intenção, não economia real) e `misterios` (floração localizada de bambu no Japão; a persistência/regeneração continua sem explicação). `saude` foi incorporado à fixture comum e mantém seu arquivo detalhado próprio. Todos os registros têm ângulo e chamada PT-BR, atribuição, tags, limites e restrições factuais; nenhuma figura/foto foi escolhida.

A política editorial está em `docs/politica-traducao-pt-br-fontes.md`: exige licença ou permissão por item para adaptação comercial, atribuição/indicação de alterações, fidelidade ao desenho/população/limites e revisão de mídia separada. Política documentada não ativa fontes. Feed, configuração, publicações e rotas de conta continuam inalterados; `account` permanece nulo até aprovação explícita do mapa tema→conta. Portanto YAI-020 permanece parcial somente pelos gates operacionais/identidade ainda pendentes.
