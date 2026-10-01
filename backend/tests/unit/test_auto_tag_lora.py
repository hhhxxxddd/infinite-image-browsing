import unittest

from omnigallery.library.auto_tag import AutoTagMatcher
from omnigallery.metadata.generation import parse_generation_parameters
from omnigallery.metadata.parsers.model import ImageGenerationParams


class AutoTagLoraTests(unittest.TestCase):
    def setUp(self):
        self.matcher = object.__new__(AutoTagMatcher)

    def rule(self, field, operator, value):
        return {"tag": "test", "filters": [{"field": field, "operator": operator, "value": value}]}

    def test_prompt_lora_names_survive_tag_normalization(self):
        parsed = parse_generation_parameters(
            "portrait, <lora:portrait_style-v2:0.75>, <lora:中文 风格:1>\n"
            "Negative prompt: blur\nSteps: 20, Sampler: Euler, CFG scale: 7, Model: base.safetensors"
        )
        self.assertEqual(
            [item["name"] for item in parsed["lora"]], ["portrait_style-v2", "中文 风格"]
        )
        params = ImageGenerationParams(
            meta=parsed["meta"], pos_prompt=parsed["pos_prompt"], extra=parsed
        )
        self.assertTrue(
            self.matcher.match(params, self.rule("lora", "equals", "PORTRAIT_STYLE-V2"))
        )
        self.assertTrue(self.matcher.match(params, self.rule("lora", "contains", "中文")))
        self.assertTrue(self.matcher.match(params, self.rule("lora", "regex", r"portrait_.+-v2")))
        self.assertFalse(self.matcher.match(params, self.rule("lora", "equals", "portrait")))
        self.assertTrue(
            self.matcher.match(params, self.rule("Model", "equals", "BASE.SAFETENSORS"))
        )

    def test_lora_rule_does_not_match_missing_resource(self):
        params = ImageGenerationParams(meta={"Model": "base.safetensors"})
        self.assertFalse(self.matcher.match(params, self.rule("lora", "contains", "base")))

    def test_lora_rule_reads_explicit_metadata_names(self):
        params = ImageGenerationParams(
            meta={"LoRA": "portrait-v2.safetensors; 中文风格.safetensors"}
        )
        self.assertTrue(
            self.matcher.match(params, self.rule("lora", "equals", "中文风格.safetensors"))
        )
        self.assertFalse(
            self.matcher.match(
                params, self.rule("lora", "equals", "portrait-v2.safetensors; 中文风格.safetensors")
            )
        )

    def test_explicit_lora_weights_are_not_part_of_resource_names(self):
        value = r"abc:0.8; C:\models\中文.safetensors:0; plain; negative:-.5"
        parsed = parse_generation_parameters(
            f"portrait\nNegative prompt: blur\nSteps: 20, Seed: 42, LoRA: {value}"
        )
        lowercase = parse_generation_parameters(
            f"portrait\nNegative prompt: blur\nSteps: 20, Seed: 42, lora: {value}"
        )
        self.assertEqual(lowercase["lora"], parsed["lora"])
        self.assertEqual(
            parsed["lora"],
            [
                {"name": "abc", "value": 0.8},
                {"name": r"C:\models\中文.safetensors", "value": 0.0},
                {"name": "plain", "value": 1.0},
                {"name": "negative", "value": -0.5},
            ],
        )
        for params in (
            ImageGenerationParams(meta=parsed["meta"], extra=parsed),
            ImageGenerationParams(meta={"LoRA": value}),
            ImageGenerationParams(meta={"lora": value}),
        ):
            self.assertTrue(self.matcher.match(params, self.rule("lora", "equals", "abc")))
            self.assertFalse(self.matcher.match(params, self.rule("lora", "equals", "abc:0.8")))


if __name__ == "__main__":
    unittest.main()
