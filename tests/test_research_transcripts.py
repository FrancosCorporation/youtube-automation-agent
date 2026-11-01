#!/usr/bin/env python3
"""
Unit tests for transcript_tools.py
"""

import unittest
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from research_transcripts import default_subtitle_dir, extract_spans, build_index


class TestExtractSpans(unittest.TestCase):
    """Tests for extract_spans function."""

    def test_basic_offset_and_duration(self):
        """Test start/end calculation with explicit duration."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 2000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 4000, "dDurationMs": 1500, "segs": [{"utf8": "world"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 2)
        self.assertAlmostEqual(spans[0]["start"], 1.0)
        self.assertAlmostEqual(spans[0]["end"], 3.0)
        self.assertFalse(spans[0]["inferred_end"])
        self.assertAlmostEqual(spans[1]["start"], 4.0)
        self.assertAlmostEqual(spans[1]["end"], 5.5)
        self.assertFalse(spans[1]["inferred_end"])

    def test_inferred_end_without_duration(self):
        """Test end inference when dDurationMs is missing."""
        data = {
            "events": [
                {"tStartMs": 1000, "segs": [{"utf8": "first"}]},
                {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "second"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 2)
        self.assertAlmostEqual(spans[0]["start"], 1.0)
        self.assertAlmostEqual(spans[0]["end"], 3.0)
        self.assertTrue(spans[0]["inferred_end"])
        self.assertAlmostEqual(spans[1]["start"], 3.0)
        self.assertAlmostEqual(spans[1]["end"], 4.0)
        self.assertFalse(spans[1]["inferred_end"])

    def test_empty_events_ignored(self):
        """Test that events without segs or empty segs are ignored."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "valid"}]},
                {"tStartMs": 2000, "dDurationMs": 1000, "segs": []},
                {"tStartMs": 3000, "dDurationMs": 1000},
                {"tStartMs": 4000, "dDurationMs": 1000, "segs": [{"utf8": ""}]},
                {"tStartMs": 5000, "dDurationMs": 1000, "segs": [{"utf8": "also valid"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["text"], "valid")
        self.assertEqual(spans[1]["text"], "also valid")

    def test_newline_and_whitespace_normalization(self):
        """Test newline replacement and whitespace normalization."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [
                    {"utf8": "hello\nworld"},
                    {"utf8": "  extra  spaces  "}
                ]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 1)
        self.assertEqual(spans[0]["text"], "hello world extra spaces")

    def test_deduplication_exact_matches_only(self):
        """Test that only exact (start, end, text) duplicates are removed."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "hello world"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 3)
        self.assertEqual(spans[0]["text"], "hello")
        self.assertEqual(spans[1]["text"], "hello")
        self.assertEqual(spans[2]["text"], "hello world")

    def test_intentional_repetition_preserved(self):
        """Test that intentional word repetition at different times is preserved."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 5000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]},
                {"tStartMs": 10000, "dDurationMs": 1000, "segs": [{"utf8": "hello"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 3)
        for span in spans:
            self.assertEqual(span["text"], "hello")

    def test_sorting_by_start_time(self):
        """Test that spans are sorted by start time."""
        data = {
            "events": [
                {"tStartMs": 5000, "dDurationMs": 1000, "segs": [{"utf8": "third"}]},
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "first"}]},
                {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "second"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual([s["text"] for s in spans], ["first", "second", "third"])
        self.assertTrue(all(spans[i]["start"] <= spans[i+1]["start"] for i in range(len(spans)-1)))

    def test_music_and_bracket_annotations_preserved(self):
        """Non-empty bracket annotations like [Music] are preserved.

        Canonical contract (scripts/research_transcripts.py): extract_spans
        keeps every non-empty text span, including [Music] and other bracket
        annotations, so downstream analysis can decide how to treat them.
        Bracket-only fragments are non-empty text and are likewise preserved.
        Filtering annotations is a separate downstream concern, not part of
        extraction.
        """
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "[Music]"}]},
                {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "["}]},
                {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "]"}]},
                {"tStartMs": 4000, "dDurationMs": 1000, "segs": [{"utf8": "real text"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual([s["text"] for s in spans],
                         ["[Music]", "[", "]", "real text"])
        # Empty or whitespace-only segments are still dropped by extraction.
        empty = {"events": [{"tStartMs": 1000, "dDurationMs": 1000,
                             "segs": [{"utf8": "   "}]}]}
        self.assertEqual(extract_spans(empty), [])

    def test_approx_segment_words_unicode(self):
        """Test word counting with Unicode regex."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 1000, "segs": [{"utf8": "hello world"}]},
                {"tStartMs": 2000, "dDurationMs": 1000, "segs": [{"utf8": "café naïve résumé"}]},
                {"tStartMs": 3000, "dDurationMs": 1000, "segs": [{"utf8": "你好 世界"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(spans[0]["approx_segment_words"], 2)
        self.assertEqual(spans[1]["approx_segment_words"], 3)
        self.assertEqual(spans[2]["approx_segment_words"], 2)

    def test_append_events_handled(self):
        """Test that aAppend events are treated as separate spans."""
        data = {
            "events": [
                {"tStartMs": 1000, "dDurationMs": 2000, "segs": [{"utf8": "first"}]},
                {"tStartMs": 1500, "dDurationMs": 1000, "aAppend": 1, "segs": [{"utf8": " continued"}]}
            ]
        }
        spans = extract_spans(data)
        self.assertEqual(len(spans), 2)
        self.assertEqual(spans[0]["text"], "first")
        self.assertEqual(spans[1]["text"], "continued")


class TestBuildIndex(unittest.TestCase):
    """Tests for build_index function."""

    def test_default_subtitle_dir_is_relative_to_workspace(self):
        expected = Path(__file__).resolve().parents[1] / "docs" / "pesquisa-virais" / "evidencias"
        self.assertEqual(default_subtitle_dir(), expected)

    def test_build_index_structure(self):
        """Test that build_index returns correct structure."""
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)
            obs_dir = tmpdir / "observations"
            obs_dir.mkdir()
            sub_dir = tmpdir / "subs"
            sub_dir.mkdir()

            meta = {
                "id": "test123",
                "title": "Test Video",
                "channel": "Test Channel",
                "view_count": 1000,
                "duration": 100,
                "upload_date": "20230101",
                "webpage_url": "https://youtube.com/watch?v=test123"
            }
            sub_data = {
                "events": [
                    {"tStartMs": 1000, "dDurationMs": 2000, "segs": [{"utf8": "hello world"}]}
                ]
            }

            with open(obs_dir / "test123.info.json", "w") as f:
                json.dump(meta, f)
            with open(sub_dir / "test123.en-orig.json3", "w") as f:
                json.dump(sub_data, f)

            index = build_index(["test123"], tmpdir, sub_dir)

            self.assertIn("generated_at", index)
            self.assertIn("videos", index)
            self.assertEqual(len(index["videos"]), 1)
            v = index["videos"][0]
            self.assertEqual(v["id"], "test123")
            self.assertEqual(v["title"], "Test Video")
            self.assertEqual(v["channel"], "Test Channel")
            self.assertEqual(v["view_count"], 1000)
            self.assertEqual(v["duration"], 100)
            self.assertEqual(v["upload_date"], "20230101")
            self.assertEqual(v["url"], "https://youtube.com/watch?v=test123")
            self.assertEqual(len(v["spans"]), 1)

    def test_duration_boundary_clamping(self):
        """Test that span ends don't exceed duration + 1 second."""
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir = Path(tmpdir)
            obs_dir = tmpdir / "observations"
            obs_dir.mkdir()
            sub_dir = tmpdir / "subs"
            sub_dir.mkdir()

            meta = {
                "id": "test123",
                "title": "Test",
                "channel": "Test",
                "view_count": 100,
                "duration": 10,
                "upload_date": "20230101",
                "webpage_url": "https://youtube.com/watch?v=test123"
            }
            sub_data = {
                "events": [
                    {"tStartMs": 9000, "dDurationMs": 5000, "segs": [{"utf8": "late text"}]}
                ]
            }

            with open(obs_dir / "test123.info.json", "w") as f:
                json.dump(meta, f)
            with open(sub_dir / "test123.en-orig.json3", "w") as f:
                json.dump(sub_data, f)

            index = build_index(["test123"], tmpdir, sub_dir)
            self.assertEqual(len(index["videos"]), 1)
            span = index["videos"][0]["spans"][0]
            self.assertLessEqual(span["end"], 11.0)
