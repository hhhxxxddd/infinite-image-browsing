from dataclasses import dataclass


@dataclass(frozen=True)
class TopicSearchConfig:
    openai_base_url: str
    openai_api_key: str
    embedding_model: str
    ai_model: str
    twelvelabs_api_key: str = ""
