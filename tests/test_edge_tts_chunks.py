import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "edge_tts_chunks", Path(__file__).parents[1] / "scripts/synthesize-edge-tts-word-boundaries.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TtsChunkTests(unittest.TestCase):
    def test_chunks_preserve_all_words_and_utf8_byte_limit(self):
        text = "A narração mantém informação, ação e emoção sem alterar a voz. " * 100
        chunks = module.chunk_text(text, 1800)
        self.assertGreater(len(chunks), 1)
        self.assertEqual(" ".join(chunks).split(), text.split())
        self.assertTrue(all(0 < len(chunk.encode("utf-8")) <= 1800 for chunk in chunks))

    def test_short_sentences_stay_complete_and_long_sentences_split_only_on_spaces(self):
        text = "Esta frase fica inteira. Esta outra também fica inteira."
        self.assertEqual(module.chunk_text(text), [text])
        long_text = "informação " * 300
        self.assertEqual(" ".join(module.chunk_text(long_text)).split(), long_text.split())
        with self.assertRaises(ValueError):
            module.chunk_text("x" * 1801)


if __name__ == "__main__":
    unittest.main()
