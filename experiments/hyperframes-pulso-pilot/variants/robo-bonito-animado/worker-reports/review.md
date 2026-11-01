# Revisão NVIDIA

rig-contract.json aceito como extração mecânica: hash, 17 joints/parents/pivots, contagens e normalização conferem com código/rig-audit. Todos encaixe/deformação/pose/bind permanecem pendentes até QA real.

audio-proof-times.json rejeitado: retornou durações de frases/pausas em vez de tempos absolutos de amostras do envelope; método declarado não corresponde ao pedido. Nenhum tempo desse worker foi usado. Orquestrador calculou tempos diretamente, validando zeros e picos; arquivo canônico ../audio-proof-times.json.
