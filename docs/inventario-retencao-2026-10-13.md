# Inventário agregado de retenção — 13/10/2026

Snapshot somente leitura coletado em 13/10/2026 no checkout `youtube-automation-agent`. Contagens e tamanhos mudam durante a operação. O relatório omite nomes de arquivos e títulos.

| Área | Arquivos | Bytes | MiB aproximados | Idade por mtime: <7d / 7–30d / 30–90d / >90d |
|---|---:|---:|---:|---:|
| `data/videos/` | 1.052 | 3.969.859.029 | 3.785,6 | 1.050 / 2 / 0 / 0 |
| `logs/` | 3.631 | 761.204.823 | 725,9 | 3.454 / 177 / 0 / 0 |
| `experiments/hyperframes-pulso-pilot/renders/` | 131 | 231.212.727 | 220,5 | 131 / 0 / 0 / 0 |
| `data/state/` | 7 | 147.137 | 0,14 | 7 / 0 / 0 / 0 |

Extensões de maior volume:

- `data/videos/`: 42 MP4 (3.748.852.752 bytes), 499 MP3 (216.836.740 bytes), 12 PNG, 452 SRT e 47 TXT.
- `logs/`: 3.061 PNG (742.222.443 bytes) e 570 LOG (18.982.380 bytes).
- `renders/`: 11 MP4 (149.238.907 bytes), 118 PNG (72.577.356 bytes), um GLB e um SVG.
- `data/state/`: sete JSON, total de 147.137 bytes.

O volume raiz tinha 218 GB, 126 GB usados, 82 GB disponíveis e 61% de uso (`df -h /`). Isso é uma medição daquele instante, não uma previsão de capacidade.

## Prévia da limpeza existente

`node utils/disk-cleanup.js` foi executado sem `--apply`; portanto, nenhuma remoção foi solicitada. A prévia selecionou 99 snapshots de depuração, cerca de 20,1 MB. O próprio script pulou cache de imagens por haver uma geração ativa e cache de navegador por existir Chromium usando um perfil. O comando carrega `.env` do checkout, então seu resultado não reproduz necessariamente o ambiente do processo systemd.

O seletor de mídia publicada exige confirmação elegível no ledger, idade além da carência, ausência da fila e caminhos dentro da raiz gerenciada. Não houve candidato de master/corte reportado nesta prévia. O resultado não valida publicação em cada plataforma nem comprova a segurança de estados legados.

## Limites

- O mtime não determina se uma mídia é dispensável; uso operacional, origem, retry e status de publicação precisam ser conciliados.
- A configuração observada `DELETE_AFTER_UPLOAD=1` não substitui a validação dos registros nem define a retenção aprovada.
- Não há prazo global aprovado para logs, evidências, masters, fontes ou renders experimentais.
- Não foi comprovado um destino externo criptografado nem feita cópia/restauração de mídia real.
- Os dados foram listados por extensão e faixa de idade; nenhum nome ou título foi incluído neste documento.
