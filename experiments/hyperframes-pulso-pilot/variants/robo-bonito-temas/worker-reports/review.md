# Revisão dos workers NVIDIA

Nemotron via OpenCode, provider NVIDIA autorizado. Saídas apenas mecânicas; nenhuma aprovação visual delegada.

1. theme-colors: 10 IDs, brands e duas cores por tema comparados exatamente ao config/themes.json; seleção por seed conferida no renderer. Recomendação de casco não adotada automaticamente: textura original foi preservada.
2. rig-evidence-summary: extração mecânica comparada aos JSONs locais. Revalidação de 17/10 cobre as duas primitivas skinned no runtime (500.036 triângulos), os quatro aspects/temas e os transforms completos em reloads. `poseStateMatchesReload` e `freshContextStable` substituem a comparação estrita de hash RGB entre contexts; esta registra variação de iluminação RGB embora pose e máscara alfa coincidam. `rigid_triangles` é a contagem (500036), não booleano, e foi validada contra todos os triângulos rigidamente ligados a um osso. A inspeção de imagens permanece humana; o parecer do worker não aprova anatomia ou estética.

Execuções: pulso-fleet-v6awtusu e pulso-fleet-t29qnj7i em /media/servidor/nvme_data/scratch/tmp/. Implementação, auditoria geométrica, frames do MP4 e integração feitos pelo orquestrador.
