import unittest
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from pulso_word_alignments import align_words


def fake_phonemize_single(word: str) -> list[list[str]]:
    return [[c for c in word]]


def fake_phonemize_franradar(word: str) -> list[list[str]]:
    if word == "FranRadar.":
        return [['f', 'r', 'a', 'n', ' ', 'r', 'a', 'd', 'a', 'r', '.']]
    if word == "FranRadar":
        return [['f', 'r', 'a', 'n', ' ', 'r', 'a', 'd', 'a', 'r']]
    return [[c for c in word]]


def fake_phonemize_camel(word: str) -> list[list[str]]:
    if word in ("CamelCase", "FranRadar"):
        return [['c', 'a', 'm', 'e', 'l', ' ', 'c', 'a', 's', 'e']]
    return [[c for c in word]]


def fake_phonemize_accented(word: str) -> list[list[str]]:
    if word == "café":
        return [['k', 'a', 'f', 'e', 'ˈ']]
    if word == "naïve":
        return [['n', 'a', 'ˈ', 'i', 'v']]
    return [[c for c in word]]


class TestAlignWords(unittest.TestCase):
    def test_basic_alignment(self):
        text = "Oi Eu sou"
        groups = [
            {"start": 0.0, "end": 0.5},
            {"start": 0.5, "end": 1.0},
            {"start": 1.0, "end": 1.5},
        ]
        result = align_words(text, groups, fake_phonemize_single)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[0]["word"], "Oi")
        self.assertEqual(result[0]["start"], 0.0)
        self.assertEqual(result[0]["end"], 0.5)
        self.assertEqual(result[1]["word"], "Eu")
        self.assertEqual(result[2]["word"], "sou")

    def test_preserves_punctuation_and_accents(self):
        text = "Olá! Como vai?"
        groups = [
            {"start": 0.0, "end": 0.4},
            {"start": 0.4, "end": 0.8},
            {"start": 0.8, "end": 1.2},
        ]
        result = align_words(text, groups, fake_phonemize_accented)
        self.assertEqual(result[0]["word"], "Olá!")
        self.assertEqual(result[1]["word"], "Como")
        self.assertEqual(result[2]["word"], "vai?")

    def test_accented_words(self):
        text = "café naïve"
        groups = [
            {"start": 0.0, "end": 0.5},
            {"start": 0.5, "end": 1.0},
        ]
        result = align_words(text, groups, fake_phonemize_accented)
        self.assertEqual(result[0]["word"], "café")
        self.assertEqual(result[1]["word"], "naïve")

    def test_camelcase_expansion(self):
        text = "FranRadar"
        groups = [
            {"start": 0.0, "end": 0.5},
            {"start": 0.5, "end": 1.0},
        ]
        result = align_words(text, groups, fake_phonemize_camel)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["word"], "FranRadar")
        self.assertEqual(result[0]["start"], 0.0)
        self.assertEqual(result[0]["end"], 1.0)

    def test_franradar_with_punctuation(self):
        text = "Abra o FranRadar."
        groups = [
            {"start": 0.0, "end": 0.3},
            {"start": 0.3, "end": 0.5},
            {"start": 0.5, "end": 1.0},
            {"start": 1.0, "end": 1.5},
        ]
        result = align_words(text, groups, fake_phonemize_franradar)
        self.assertEqual(len(result), 3)
        self.assertEqual(result[2]["word"], "FranRadar.")
        self.assertEqual(result[2]["start"], 0.5)
        self.assertEqual(result[2]["end"], 1.5)

    def test_example_from_spec(self):
        text = "Oi! Eu sou o Pulso. Abra o FranRadar."
        groups = [
            {"start": 0.0, "end": 0.3},
            {"start": 0.3, "end": 0.5},
            {"start": 0.5, "end": 0.8},
            {"start": 0.8, "end": 1.0},
            {"start": 1.0, "end": 1.4},
            {"start": 1.4, "end": 1.7},
            {"start": 1.7, "end": 2.0},
            {"start": 2.0, "end": 2.5},
            {"start": 2.5, "end": 3.0},
        ]
        result = align_words(text, groups, fake_phonemize_franradar)
        self.assertEqual(len(result), 8)
        self.assertEqual(result[7]["word"], "FranRadar.")
        self.assertEqual(result[7]["start"], 2.0)
        self.assertEqual(result[7]["end"], 3.0)

    def test_error_group_count_mismatch(self):
        text = "Oi Eu"
        groups = [
            {"start": 0.0, "end": 0.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("não corresponde", str(ctx.exception))

    def test_error_only_punctuation(self):
        text = "Oi ..."
        groups = [
            {"start": 0.0, "end": 0.5},
            {"start": 0.5, "end": 1.0},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("apenas pontuação", str(ctx.exception))

    def test_error_negative_start(self):
        text = "Oi"
        groups = [
            {"start": -0.1, "end": 0.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("negativos", str(ctx.exception))

    def test_error_nan_start(self):
        text = "Oi"
        groups = [
            {"start": float("nan"), "end": 0.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("finitos", str(ctx.exception))

    def test_error_end_equals_start(self):
        text = "Oi"
        groups = [
            {"start": 0.5, "end": 0.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("> start", str(ctx.exception))

    def test_error_overlap(self):
        text = "Oi Eu"
        groups = [
            {"start": 0.0, "end": 1.0},
            {"start": 0.5, "end": 1.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("overlap", str(ctx.exception))

    def test_error_end_before_start_next(self):
        text = "Oi Eu"
        groups = [
            {"start": 0.0, "end": 1.0},
            {"start": 0.999998, "end": 1.5},
        ]
        with self.assertRaises(ValueError) as ctx:
            align_words(text, groups, fake_phonemize_single)
        self.assertIn("overlap", str(ctx.exception))

    def test_tolerance_1e6(self):
        text = "Oi Eu"
        groups = [
            {"start": 0.0, "end": 1.0},
            {"start": 1.0 - 1e-7, "end": 1.5},
        ]
        result = align_words(text, groups, fake_phonemize_single)
        self.assertEqual(len(result), 2)

    def test_input_immutable_text(self):
        text = "Oi Eu"
        groups = [{"start": 0.0, "end": 0.5}, {"start": 0.5, "end": 1.0}]
        original_text = text
        align_words(text, groups, fake_phonemize_single)
        self.assertEqual(text, original_text)

    def test_input_immutable_groups(self):
        text = "Oi"
        groups = [{"start": 0.0, "end": 0.5}]
        original_groups = [{"start": 0.0, "end": 0.5}]
        align_words(text, groups, fake_phonemize_single)
        self.assertEqual(groups, original_groups)

    def test_empty_text(self):
        text = ""
        groups = []
        result = align_words(text, groups, fake_phonemize_single)
        self.assertEqual(result, [])

    def test_ignores_stress_and_markers_in_count(self):
        def phonemize_with_stress(word: str) -> list[list[str]]:
            if word == "teste":
                return [['ˈ', 't', 'e', 's', 't', 'e', 'ˌ']]
            return [[c for c in word]]

        text = "teste"
        groups = [{"start": 0.0, "end": 0.5}]
        result = align_words(text, groups, phonemize_with_stress)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["word"], "teste")

    def test_ignores_punctuation_in_phoneme_groups(self):
        def phonemize_with_punct(word: str) -> list[list[str]]:
            if word == "olá":
                return [['o', 'l', 'a', '.']]
            return [[c for c in word]]

        text = "olá"
        groups = [{"start": 0.0, "end": 0.5}]
        result = align_words(text, groups, phonemize_with_punct)
        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)