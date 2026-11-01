# Revisão do orquestrador

- seek-review.json: aceito como extração. Duração 8; limites 0/2/4/6; transforms absolutas conferidas no código. QA visual e seek continuam pendentes.
- baseline.json: parcialmente aceito. Bytes, triângulos, vértices, skins e clips conferem. Worker omitiu source_dimensions e embedded_assets pedidos, embora contrato básico não os exigisse. Auditoria direta revalidacao-anterior.json é fonte para esses campos. Critérios permanecem pending até inspeção real.
- Rodada usou dois workers NVIDIA Nemotron, uma tentativa por tarefa; nenhum relatório constitui aprovação do modelo.
