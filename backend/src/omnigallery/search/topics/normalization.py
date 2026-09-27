import hashlib
import json
import os
import re

_PROMPT_NORMALIZE_ENABLED = os.getenv("OMNIGALLERY_PROMPT_NORMALIZE", "1").strip().lower() not in [
    "0",
    "false",
    "no",
    "off",
]


_PROMPT_NORMALIZE_MODE = (
    (os.getenv("OMNIGALLERY_PROMPT_NORMALIZE_MODE", "balanced") or "balanced").strip().lower()
)


_DROP_PATTERNS_COMMON = [
    # SD / A1111 tags
    r"<lora:[^>]+>",
    r"<lyco:[^>]+>",
    # quality / resolution / generic
    r"\b(masterpiece|best\s*quality|high\s*quality|best\s*rating|(?:highly|ultra|hyper)[-\s\u2010\u2011\u2012\u2013\u2212]*detailed|absurdres|absurd\s*res|hires|hdr|uhd|8k|4k|2k|raw\s*photo|photorealistic|realistic|cinematic)\b",
    # photography / camera / lens
    r"\b(film\s+photography|photography|dslr|camera|canon|nikon|sony|sigma|leica|lens|bokeh|depth\s+of\s+field|dof|sharp\s+focus|wide\s+angle|fisheye)\b",
    r"\b(iso\s*\d{2,5}|f\/\d+(?:\.\d+)?|\d{2,4}mm)\b",
]


_DROP_PATTERNS_ZH_COMMON = [
    r"(超高分辨率|高分辨率|高清|超清|8K|4K|2K|照片级|高质量|最佳质量|大师作品|杰作|超细节|细节丰富|极致细节|极致|完美)",
]


_DROP_PATTERNS_ZH_STYLE = [
    r"(电影质感|写真|写实|真实感|摄影|摄影作品|摄影图像|摄影图|镜头|景深|胶片|光圈|光影|构图|色彩|渲染|纪实|插图|科学插图)",
]


def _build_drop_re() -> re.Pattern:
    pats = list(_DROP_PATTERNS_COMMON) + list(_DROP_PATTERNS_ZH_COMMON)
    if _PROMPT_NORMALIZE_MODE in ["theme", "theme_only", "strict"]:
        pats += list(_DROP_PATTERNS_ZH_STYLE)
    return re.compile("|".join(f"(?:{p})" for p in pats), flags=re.IGNORECASE)


_DROP_RE = _build_drop_re()


def _compute_prompt_normalize_version() -> str:
    """
    IMPORTANT:
    - Do NOT allow users to override normalize-version via environment variables.
    - Version should be deterministic from the normalization rules themselves, so cache invalidation
      happens automatically when we change rules in code (or switch mode).
    """
    payload = {
        "enabled": bool(_PROMPT_NORMALIZE_ENABLED),
        "mode": str(_PROMPT_NORMALIZE_MODE),
        "drop_common": list(_DROP_PATTERNS_COMMON),
        "drop_zh_common": list(_DROP_PATTERNS_ZH_COMMON),
        "drop_zh_style": list(_DROP_PATTERNS_ZH_STYLE),
    }
    s = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return "nv_" + hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


_PROMPT_NORMALIZE_VERSION = _compute_prompt_normalize_version()


def _extract_prompt_text(raw_exif: str, max_chars: int = 4000) -> str:
    """
    Extract the natural-language prompt part from stored exif text.
    Keep text before 'Negative prompt:' to preserve semantics.
    """
    if not isinstance(raw_exif, str):
        return ""
    s = raw_exif.strip()
    if not s:
        return ""
    idx = s.lower().find("negative prompt:")
    if idx != -1:
        s = s[:idx].strip()
    if len(s) > max_chars:
        s = s[:max_chars]
    return s.strip()


def _clean_prompt_for_semantic(text: str) -> str:
    """
    Light, dependency-free prompt normalization:
    - remove lora tags / SD boilerplate / quality & photography descriptors
    - keep remaining text as 'theme' semantic signal for embeddings/clustering
    """
    if not isinstance(text, str):
        return ""
    s = text
    # remove negative prompt tail early (safety if caller passes raw exif)
    s = re.sub(r"(negative prompt:).*", " ", s, flags=re.IGNORECASE | re.DOTALL)
    # remove weights like (foo:1.2)
    s = re.sub(r"\(([^()]{1,80}):\s*\d+(?:\.\d+)?\)", r"\1", s)
    # drop boilerplate patterns
    s = _DROP_RE.sub(" ", s)
    # normalize separators
    s = s.replace("**", " ")
    s = re.sub(r"[\[\]{}()]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # If it's a comma-tag style prompt, remove empty / tiny segments.
    parts = re.split(r"[,\n，;；]+", s)
    kept: list[str] = []
    for p in parts:
        t = p.strip()
        if not t:
            continue
        # drop segments that are basically leftover boilerplate (too short or all punctuation)
        if len(t) <= 2:
            continue
        kept.append(t)
    s2 = "，".join(kept) if kept else s
    return s2.strip()


def _clean_for_title(text: str) -> str:
    if not isinstance(text, str):
        return ""
    s = text
    s = s.replace("**", " ")
    s = re.sub(r"<lora:[^>]+>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"<lyco:[^>]+>", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"(negative prompt:).*", " ", s, flags=re.IGNORECASE | re.DOTALL)
    s = re.sub(r"(prompt:|提示词[:：]|提示[:：]|输出[:：])", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _title_from_representative_prompt(text: str, max_len: int = 18) -> str:
    """
    Local fallback title: take the first sentence/clause and truncate.
    This is much more readable than token n-grams without Chinese word segmentation.
    """
    # Use the same semantic cleaner as embeddings to avoid boilerplate titles like
    # "masterpiece, best quality" / "A highly detailed ..."
    base = _clean_for_title(text)
    s = _clean_prompt_for_semantic(base) if _PROMPT_NORMALIZE_ENABLED else base
    if not s:
        s = base
    if not s:
        return "主题"
    # Split by common sentence punctuations, keep the first segment.
    seg = re.split(r"[。！？!?\n\r;；]+", s)[0].strip()
    # Remove leading punctuation / separators
    seg = re.sub(r"^[,，;；:：\s-]+", "", seg).strip()
    # Remove leading english articles for nicer titles
    seg = re.sub(r"^(a|an|the)\s+", "", seg, flags=re.IGNORECASE).strip()
    # Strip common boilerplate templates in titles while keeping discriminative words.
    # English: "highly detailed scientific rendering/illustration of ..."
    seg = re.sub(
        r"^(?:(?:highly|ultra|hyper)[-\s\u2010\u2011\u2012\u2013\u2212]*detailed\s+)?(?:scientific\s+)?(?:rendering|illustration|image|depiction|scene)\s+of\s+",
        "",
        seg,
        flags=re.IGNORECASE,
    ).strip()
    # Chinese: "一张...图像/插图/照片..." template
    seg = re.sub(
        r"^一[张幅]\s*[^，,。]{0,20}(?:图像|插图|照片|摄影图像|摄影作品)\s*[，, ]*", "", seg
    ).strip()
    # Remove trailing commas/colons
    seg = re.sub(r"[,:，：]\s*$", "", seg).strip()
    # If still too long, hard truncate.
    if len(seg) > max_len:
        seg = seg[:max_len].rstrip()
    return seg or "主题"
