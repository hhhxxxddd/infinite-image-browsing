from pydantic import BaseModel


class BuildMediaOutputEmbeddingRequest(BaseModel):
    folder: str | None = None  # default: {cwd}/media_output
    model: str | None = None
    force: bool | None = False
    batch_size: int | None = 64
    max_chars: int | None = 4000
    # Include subfolders in the embedding request by default.
    recursive: bool | None = True


class ClusterMediaOutputRequest(BaseModel):
    folder: str | None = None
    folder_paths: list[str] | None = None
    model: str | None = None
    force_embed: bool | None = False
    # Default a bit stricter to avoid over-merged broad topics for natural-language prompts.
    threshold: float | None = 0.90
    batch_size: int | None = 64
    max_chars: int | None = 4000
    min_cluster_size: int | None = 2
    # B: LLM title generation
    title_model: str | None = None
    # Reduce noise by reassigning small-cluster members to best large cluster if similarity is high enough
    assign_noise_threshold: float | None = None
    # Cache titles in sqlite to avoid repeated LLM calls
    use_title_cache: bool | None = True
    force_title: bool | None = False
    # Output language for titles/keywords (from frontend globalStore.lang)
    lang: str | None = None
    # Include subfolders in topic search by default.
    recursive: bool | None = True
    # Existing folder names in dest directory (for file organize: AI will prefer reusing these)
    existing_folder_names: list[str] | None = None


class PromptSearchRequest(BaseModel):
    query: str
    folder: str | None = None
    folder_paths: list[str] | None = None
    model: str | None = None
    top_k: int | None = 50
    min_score: float | None = 0.0
    # Ensure embeddings exist/updated before searching
    ensure_embed: bool | None = True
    # Use the same normalization as clustering
    max_chars: int | None = 4000
