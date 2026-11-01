# Como uma encomenda encontra o caminho até você

Novo teste de tema e narração após a crítica ao piloto CHAPEA. Explicação de logística com fontes oficiais dos Correios, personagens fictícios em malhas GLB completas e o robô aprovado. As seis sequências são identificação, separação por destino, transporte, distribuição, entrega e consulta das etapas registradas. O esquema não representa uma rota/endereço/transportadora real.

As roupas e a identidade dos personagens permanecem iguais durante o episódio. A história não exige troca de figurino; a regra geral de mostrar preparação e conclusão está registrada no padrão criativo. O personagem atravessa o vão depois de a porta abrir; a caixa chega à destinatária e continua com ela ao fim da entrega. Mãos usam IK sobre o esqueleto humano, sem substituir pessoas por cápsulas. A origem e os hashes das malhas locais do proprietário estão em `models-provenance.json`.

## Reprodução

Depois de restaurar o pacote de assets na raiz do repositório:

```bash
node benchmarks/video_3d/parcel_demo/render-and-review.cjs
node benchmarks/video_3d/parcel_demo/render-and-review.cjs --portrait
node benchmarks/video_3d/parcel_demo/render-and-review.cjs --qa-only
node benchmarks/video_3d/parcel_demo/render-and-review.cjs --portrait --qa-only
node benchmarks/video_3d/shared/guard.cjs node benchmarks/video_3d/parcel_demo/seek-check.cjs
python3 benchmarks/video_3d/parcel_demo/package-assets.py
```

Preparação reutiliza a voz/alinhamentos existentes. Render e prévias usam o guard/lock compartilhados com o scheduler. Outputs: `benchmarks/video_3d/outputs/parcel_delivery.mp4` e `parcel_delivery_vertical.mp4`. Cada arquivo tem layout próprio, 55 s e 30 fps, com relatórios por formato em `reports/`.

O gate de encenação amostra 5.403 estados de corpo/carga/porta e a separação dos corpos, além dos quatro cantos da caixa sobre as esteiras. Os testes cobrem porta fechada/insuficiente e quadros congelados na área 3D mesmo quando o apresentador se move. São envelopes conservadores e trajetórias desta cena; não verificam toda topologia, todos os dedos, estética ou qualquer notícia arbitrária.

O detector de congelamento trabalha no viewport 3D com tolerância −80 dB e duração de três segundos; texto e robô não ocultam uma cena parada. O primeiro scan global a −50 dB marcou movimentos lentos como congelamentos; seu relatório foi preservado em `reports/landscape/initial-low-motion-report.json`. A mudança foi verificada com fixtures de cena parada/apresentador em movimento e cena em movimento/layout parado. QA técnico não aprova sozinho continuidade ou qualidade visual; os relatórios começam com revisão visual pendente.

Este episódio é autoria específica em código, com componente humano e regras de movimento reutilizáveis. A direção também foi aplicada ao prompt das duas rotas do autor de produção e aos reparos/cache. Isso não equivale a integrar estes GLBs à autoria automática de todas as pautas nem a demonstrar publicação recorrente. YAI-063 continua parcial.
