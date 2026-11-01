# Gerar uma nova prévia

No container, a partir desta pasta:

```bash
npm run make-video
```

O comando compila as cenas 3D e renderiza um MP4 16:9 em `renders/`. Cada execução escolhe uma seed nova para variar sutilmente a paleta e a atuação do apresentador. Para reproduzir a mesma versão:

```bash
npm run make-video -- --seed 20261011
```

Para escolher o nome e o destino do arquivo:

```bash
npm run make-video -- --seed 20261011 --output renders/minha-previa.mp4
```

O render é local e headless; não abre navegador nem publica o vídeo.
