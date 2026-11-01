import math
from typing import Callable


def align_words(
    text: str,
    groups: list[dict],
    phonemize: Callable[[str], list[list[str]]]
) -> list[dict]:
    tokens = text.split()
    _validate_groups(groups)
    if not tokens:
        if groups: raise ValueError('Empty text with non-empty timings')
        return []

    token_groups = []
    total_expected = 0

    for token in tokens:
        if _is_only_punctuation(token):
            raise ValueError(f"Token contém apenas pontuação: {token}")

        phoneme_groups = phonemize(token)
        non_empty_count = _count_non_empty_groups(phoneme_groups)

        if non_empty_count == 0:
            raise ValueError(f"Token não produziu grupos fonêmicos não vazios: {token}")

        token_groups.append({
            "token": token,
            "group_count": non_empty_count,
            "phoneme_groups": phoneme_groups
        })
        total_expected += non_empty_count

    if total_expected != len(groups):
        raise ValueError(
            f"Total de grupos fonêmicos ({total_expected}) não corresponde a len(groups) ({len(groups)})"
        )

    result = []
    group_idx = 0

    for tg in token_groups:
        count = tg["group_count"]
        start = groups[group_idx]["start"]
        end = groups[group_idx + count - 1]["end"]
        result.append({
            "word": tg["token"],
            "start": start,
            "end": end
        })
        group_idx += count

    return result


def _validate_groups(groups: list[dict]) -> None:
    if not groups:
        return

    prev_end = -1.0
    for i, g in enumerate(groups):
        start = g.get("start")
        end = g.get("end")

        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(f"Grupo {i}: start/end devem ser numéricos")

        if not math.isfinite(start) or not math.isfinite(end):
            raise ValueError(f"Grupo {i}: start/end devem ser finitos")

        if start < 0 or end < 0:
            raise ValueError(f"Grupo {i}: start/end não podem ser negativos")

        if end <= start:
            raise ValueError(f"Grupo {i}: end deve ser > start")

        if i > 0:
            if start < prev_end - 1e-6:
                raise ValueError(f"Grupo {i}: start ({start}) < end anterior ({prev_end}) - overlap")

        prev_end = end


def _is_only_punctuation(token: str) -> bool:
    punctuation_chars = set(".,!?;:")
    return all(c in punctuation_chars for c in token)


def _count_non_empty_groups(phoneme_groups: list[list[str]]) -> int:
    ignored_symbols = {"^", "$", ".", ",", "!", "?", ";", ":", "ˈ", "ˌ"}
    count = 0

    for group in phoneme_groups:
        subgroups = _split_by_space(group)
        for subgroup in subgroups:
            has_content = False
            for symbol in subgroup:
                if symbol not in ignored_symbols:
                    has_content = True
                    break
            if has_content:
                count += 1

    return count


def _split_by_space(group: list[str]) -> list[list[str]]:
    result = []
    current = []
    for symbol in group:
        if symbol == " ":
            if current:
                result.append(current)
                current = []
        else:
            current.append(symbol)
    if current:
        result.append(current)
    return result