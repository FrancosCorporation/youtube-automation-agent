#!/usr/bin/env python3
"""Package the reproducible audio and review evidence for the CHAPEA pilot."""
import hashlib
import json
import zipfile
from pathlib import Path

DEMO = Path(__file__).resolve().parent
BENCHMARK = DEMO.parent
ROOT = BENCHMARK.parents[1]
WORK = BENCHMARK / ".work"
ARCHIVE = WORK / "news-chapea-assets-v2.15.0.zip"
CHECKSUMS = WORK / "SHA256SUMS-news-chapea-v2.15.0.txt"
OUTPUT = BENCHMARK / "outputs/news_chapea_procedural.mp4"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    if not OUTPUT.is_file():
        raise SystemExit(f"MP4 final ausente: {OUTPUT}")
    report = json.loads((DEMO / "reports/render-qa.json").read_text())
    if report.get("status") != "passed" or report.get("sha256") != sha256(OUTPUT.read_bytes()):
        raise SystemExit("QA ausente/falhou ou SHA do MP4 diverge do relatório")

    files = [
        DEMO / "audio-envelope.json",
        DEMO / "narracao-original.mp3",
        DEMO / "narracao.m4a",
        DEMO / "narracao.wav",
        DEMO / "narracao.txt",
        DEMO / "palavras.json",
        DEMO / "noticia.md",
        DEMO / "storyboard.json",
        DEMO / "review-contact-sheet.png",
        DEMO / "reports/render-qa.json",
        *(DEMO / "review_frames").glob("frame-*.png"),
    ]
    missing = [str(path) for path in files if not path.is_file()]
    if missing:
        raise SystemExit("Assets ausentes: " + ", ".join(missing))

    manifest = {
        str(path.relative_to(ROOT)): sha256(path.read_bytes())
        for path in sorted(files)
    }
    WORK.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as bundle:
        for path in sorted(files):
            bundle.write(path, path.relative_to(ROOT))
        bundle.writestr("assets-manifest.json", json.dumps(manifest, indent=2) + "\n")

    with zipfile.ZipFile(ARCHIVE) as bundle:
        for name, digest in manifest.items():
            if sha256(bundle.read(name)) != digest:
                raise SystemExit(f"Falha ao verificar o ZIP: {name}")

    checksum_files = [OUTPUT, ARCHIVE, DEMO / "review-contact-sheet.png"]
    CHECKSUMS.write_text("".join(
        f"{sha256(path.read_bytes())}  {path.name}\n" for path in checksum_files
    ))
    print(json.dumps({
        "archive": str(ARCHIVE.relative_to(ROOT)),
        "files": len(files),
        "archiveBytes": ARCHIVE.stat().st_size,
        "manifestVerified": True,
        "checksums": str(CHECKSUMS.relative_to(ROOT)),
    }))


if __name__ == "__main__":
    main()
