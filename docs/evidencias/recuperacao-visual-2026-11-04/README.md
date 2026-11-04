# Recuperação de vídeos com crítica visual — 04/11/2026

A geração concluía MP4/cortes, mas a revisão recusava o master. O consumer repetia a checagem sem caminho para reparo. `visual-rebuild-recovery.js` passa a reservar uma substituição única por SHA da crítica e inseri-la na fila de recuperações do produtor existente. A reserva antecede o enqueue para resistir a crash. Não há outro scheduler nem publicação pelo produtor.

A tentativa conserva a referência ao manifesto reprovado, seu hash e a profundidade de recuperação. O modo `--resume` agora aceita reconstrução somente com checkpoint coincidente; saída existente segue para as verificações de identidade/hash do renderer. Fonte original e symlinks não podem ser sobrescritos. Publicações confirmadas ou incertas, fontes inelegíveis e linhagens com duas reconstruções não são elegíveis. Cenas fora da crítica são revalidadas e reutilizadas; nenhuma chamada de modelo é necessária para elas.

## Validação

- CI isolada `scripts/run-ci-tests.sh`: exit 0, incluindo browser e 40 testes Python.
- 90 testes focados em revisão, geração, fila, autoria e recuperação: passaram.
- Após adicionar preservação de capítulos: 61 testes focados adicionais passaram.
- Lint e diff-check passaram.
- Job real `aadd101f-53bd-4eb9-b758-740a42ab4b1a`: crítica SHA `70325f60e855ba7f150bd89a42cd55ac4aae78d2312bdb7c7bee2e4231ee2807`, narração SHA `b1b32aef96c4c4909161f8e952b67b7d173a02a0a3a50a9ac6bdcdfa5a97723f`.
- Preparação isolada com todos os assets reais produziu um único job de substituição `b54a55d7-996a-4185-8f90-e07ea14162ae`; não alterou a fila de produção. `scene-02` é alvo; 01 e 03–08 preserváveis.

## Limites e continuidade

Não é prova de render reconstruído, qualidade estética nem envio. O master original permanece rejeitado. A política existente exige revisão nova da reconstrução; essa exigência não foi removida para obter aprovação artificial. A renderização `a5d00fbc` estava ativa; não foi interrompida. O guard aplica a recarga quando producer, consumer, filhos e locks comprovarem ociosidade.

A alteração experimental em `narrative-actor-framing.js` e seu teste, mudanças anteriores de TTS/apoio/benchmark e `.planning` permanecem locais, fora do commit desta entrega. O enquadramento precisa de capturas novas horizontal/vertical. Ainda faltam a prova real da recuperação, sua revisão, publicação, ciclo seguinte e a integração X.
