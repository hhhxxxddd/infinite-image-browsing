def normalize_output_lang(lang: str | None) -> str:
    """
    Map frontend language keys to a human-readable instruction for LLM output language.
    Frontend uses: en / zhHans / zhHant / de

    Args:
        lang: Language code from frontend (e.g., "zhHans", "en", "de")

    Returns:
        Human-readable language name for LLM instruction
    """
    if not lang:
        return "English"
    value = str(lang).strip()
    ll = value.lower()
    # Simplified Chinese
    if ll in ["zh", "zhhans", "zh-hans", "zh_cn", "zh-cn", "cn", "zh-hans-cn", "zhs"]:
        return "Chinese (Simplified)"
    # Traditional Chinese (Taiwan, Hong Kong, Macau)
    if ll in [
        "zhhant",
        "zh-hant",
        "zh_tw",
        "zh-tw",
        "zh_hk",
        "zh-hk",
        "zh_mo",
        "zh-mo",
        "tw",
        "hk",
        "mo",
        "macau",
        "macao",
        "zht",
    ]:
        return "Chinese (Traditional)"
    # German
    if ll.startswith("de"):
        return "German"
    # English
    if ll.startswith("en"):
        return "English"
    # fallback
    return "English"
