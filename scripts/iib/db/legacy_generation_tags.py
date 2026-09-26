"""Remove tags formerly inferred unconditionally from generation metadata."""

LEGACY_GENERATION_TAG_TYPES = (
    "pos", "Model", "Sampler", "Source Identifier", "lora", "lyco",
    "Postprocess upscale by", "Postprocess upscaler", "Size", "Refiner", "Hires upscaler",
)
MIGRATION = "remove_implicit_generation_tags_v1"


def remove_legacy_generation_tags(conn):
    # Custom tags (including explicit auto-tag rule results), media types and
    # actual dimensions are independent of the retired metadata tag categories.
    with conn:
        conn.execute("CREATE TABLE IF NOT EXISTS data_migration (name TEXT PRIMARY KEY)")
        if conn.execute("SELECT 1 FROM data_migration WHERE name = ?", (MIGRATION,)).fetchone():
            return
        placeholders = ",".join("?" for _ in LEGACY_GENERATION_TAG_TYPES)
        conn.execute(
            f"DELETE FROM image_tag WHERE tag_id IN (SELECT id FROM tag WHERE type IN ({placeholders}))",
            LEGACY_GENERATION_TAG_TYPES,
        )
        conn.execute(f"DELETE FROM tag WHERE type IN ({placeholders})", LEGACY_GENERATION_TAG_TYPES)
        conn.execute("INSERT OR IGNORE INTO data_migration (name) VALUES (?)", (MIGRATION,))
