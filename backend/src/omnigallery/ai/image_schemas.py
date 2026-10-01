from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from omnigallery.ai import image_defaults
from omnigallery.workspaces.tasks import MAX_TASK_CONCURRENCY


class PromptTemplates(BaseModel):
    description: str = Field(min_length=1, max_length=2000)
    prompt: str = Field(min_length=1, max_length=2000)
    tags: str = Field(min_length=1, max_length=2000)


class ImageAIConfigRequest(BaseModel):
    provider: str
    openrouter_model: str = Field(default=image_defaults.DEFAULT_MODEL, max_length=200)
    comfy_model: str = Field(default=image_defaults.DEFAULT_COMFY_MODEL, max_length=200)
    comfy_mode: str = "router"
    comfy_workflow: dict[str, Any] | None = None
    comfy_workflow_name: str = Field(default="", max_length=200)
    comfy_image_node_id: str = ""
    comfy_image_input: str = "image"
    comfy_prompt_node_id: str = ""
    comfy_prompt_input: str = "prompt"
    comfy_output_node_id: str = ""
    prompts: PromptTemplates
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False
    comfy_api_key: str | None = Field(default=None, max_length=512)
    clear_comfy_api_key: bool = False


class ImageAIConfigPatch(ImageAIConfigRequest):
    """Only explicitly supplied fields replace the saved configuration."""

    model_config = ConfigDict(extra="forbid")
    provider: Literal["local", "openrouter", "comfy_cloud"] | None = None
    prompts: PromptTemplates | None = None


class StudioReferenceImage(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    node_id: str = Field(max_length=128)
    input: str = Field(max_length=128)


class StudioOutputMapping(BaseModel):
    node_id: str = Field(min_length=1, max_length=128)
    label: str = Field(default="", max_length=80)


class StudioEditRequest(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    mask_base64: str | None = Field(default=None, max_length=16_000_000)
    prompt: str = Field(default="", max_length=8000)
    workflow: dict[str, Any]
    image_node_id: str
    image_input: str
    mask_node_id: str = ""
    mask_input: str = ""
    prompt_node_id: str = ""
    prompt_input: str = ""
    negative_prompt: str = Field(default="", max_length=8000)
    negative_prompt_node_id: str = ""
    negative_prompt_input: str = ""
    output_node_id: str = ""
    output_mappings: list[StudioOutputMapping] | None = Field(default=None, max_length=16)
    reference_images: list[StudioReferenceImage] = Field(default_factory=list, max_length=13)


class StudioWorkflowSlot(BaseModel):
    node_id: str = Field(max_length=128)
    input: str = Field(max_length=128)


class StudioParameterOption(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    values: list[str] = Field(min_length=1, max_length=12)


class StudioWorkflowParameter(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["number", "text", "boolean", "select"]
    number_display: Literal["input", "slider"] = "input"
    targets: list[StudioWorkflowSlot] = Field(min_length=1, max_length=12)
    options: list[StudioParameterOption] = Field(default_factory=list, max_length=32)
    minimum: float | None = None
    maximum: float | None = None
    step: float | None = None


class StudioWorkflowPresetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    purpose: Literal["image_generation", "image_edit", "audio_creation", "video_creation"] = (
        "image_edit"
    )
    workflow: dict[str, Any]
    image_node_id: str = Field(default="", max_length=128)
    image_input: str = Field(default="", max_length=128)
    mask_node_id: str = Field(default="", max_length=128)
    mask_input: str = Field(default="", max_length=128)
    mask_enabled: bool = True
    prompt_node_id: str = Field(default="", max_length=128)
    prompt_input: str = Field(default="", max_length=128)
    negative_prompt_node_id: str = Field(default="", max_length=128)
    negative_prompt_input: str = Field(default="", max_length=128)
    output_node_id: str = Field(default="", max_length=128)
    output_mappings: list[StudioOutputMapping] | None = Field(default=None, max_length=16)
    reference_slots: list[StudioWorkflowSlot] = Field(default_factory=list, max_length=13)
    parameters: list[StudioWorkflowParameter] = Field(default_factory=list, max_length=32)


class StudioPresetEditRequest(BaseModel):
    workflow_id: str
    image_base64: str = Field(max_length=16_000_000)
    mask_base64: str | None = Field(default=None, max_length=16_000_000)
    prompt: str = Field(default="", max_length=8000)
    negative_prompt: str = Field(default="", max_length=8000)
    reference_images_base64: list[Annotated[str, Field(max_length=16_000_000)]] = Field(
        default_factory=list, max_length=13
    )
    parameter_values: dict[str, Any] = Field(default_factory=dict)


class CreationConfigRequest(BaseModel):
    concurrency: int | None = Field(default=None, ge=1, le=MAX_TASK_CONCURRENCY, strict=True)
    mode: str = "workflow"
    model: str = image_defaults.DEFAULT_CREATION_MODEL
    comfy_api_key: str | None = Field(default=None, max_length=512)
    clear_comfy_api_key: bool = False


class StudioRouterEditRequest(BaseModel):
    image_base64: str = Field(max_length=16_000_000)
    prompt: str = Field(min_length=1, max_length=8000)
    model: str
    aspect_ratio: str | None = None
    image_size: str | None = None
    reference_images_base64: list[Annotated[str, Field(max_length=16_000_000)]] = Field(
        default_factory=list, max_length=13
    )


class TaskRequest(BaseModel):
    workspace_id: str
    name: str = Field(min_length=1, max_length=120)
    mode: Literal["workflow", "router"]
    purpose: Literal["image_edit", "image_generation"] = "image_edit"
    request: dict
    document_id: str = Field(default="", max_length=80, pattern=r"^[\w-]*$")
    document_revision: str = Field(default="", pattern=r"^(?:[a-f0-9]{64})?$")


class StudioRouterGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1, max_length=8000)
    model: str
    aspect_ratio: str | None = None
    image_size: str | None = None


class StudioPresetGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflow_id: str
    prompt: str = Field(min_length=1, max_length=8000)
    negative_prompt: str = Field(default="", max_length=8000)
    parameter_values: dict[str, Any] = Field(default_factory=dict)
