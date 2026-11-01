import importlib.util
import unittest
from pathlib import Path

module_path = Path(__file__).resolve().parents[1] / 'scripts' / 'audit-whisper-name.py'
spec = importlib.util.spec_from_file_location('audit_whisper_name', module_path)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
edit_counts = audit.edit_counts
has_phrase = audit.has_phrase
normalize_tokens = audit.normalize_tokens


class WhisperNameAuditTest(unittest.TestCase):
    def test_normalizes_accents_and_punctuation_without_joining_separate_words(self):
        self.assertEqual(normalize_tokens('FranRadar, ação!'), ['franradar', 'acao'])
        self.assertTrue(has_phrase(['abra', 'o', 'franradar'], 'FranRadar'))
        self.assertFalse(has_phrase(['abra', 'o', 'frano', 'radar'], 'FranRadar'))

    def test_reports_word_error_operations_for_before_and_after_metrics(self):
        self.assertEqual(
            edit_counts(['o', 'franradar', 'abriu'], ['o', 'frano', 'radar', 'abriu']),
            {'substitutions': 1, 'deletions': 0, 'insertions': 1},
        )

    def test_exact_phrase_matching_requires_adjacent_tokens(self):
        self.assertTrue(has_phrase(['abra', 'o', 'franradar', 'hoje'], 'abra o'))
        self.assertFalse(has_phrase(['abra', 'fran', 'hoje', 'o'], 'abra o'))
        self.assertFalse(has_phrase(['qualquer', 'frase'], ''))


if __name__ == '__main__':
    unittest.main()
