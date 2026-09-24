import unittest

from scripts.iib.auto_tag import AutoTagMatcher
from scripts.iib.parsers.model import ImageGenerationParams
from scripts.iib.tool import parse_generation_parameters


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
        self.assertEqual([item["name"] for item in parsed["lora"]], ["portrait_style-v2", "中文 风格"])
        params = ImageGenerationParams(meta=parsed["meta"], pos_prompt=parsed["pos_prompt"], extra=parsed)
        self.assertTrue(self.matcher.match(params, self.rule("lora", "equals", "PORTRAIT_STYLE-V2")))
        self.assertTrue(self.matcher.match(params, self.rule("lora", "contains", "中文")))
        self.assertTrue(self.matcher.match(params, self.rule("lora", "regex", r"portrait_.+-v2")))
        self.assertFalse(self.matcher.match(params, self.rule("lora", "equals", "portrait")))
        self.assertTrue(self.matcher.match(params, self.rule("Model", "equals", "BASE.SAFETENSORS")))

    def test_lora_rule_does_not_match_missing_resource(self):
        params = ImageGenerationParams(meta={"Model": "base.safetensors"})
        self.assertFalse(self.matcher.match(params, self.rule("lora", "contains", "base")))

    def test_lora_rule_reads_explicit_metadata_names(self):
        params = ImageGenerationParams(meta={"LoRA": "portrait-v2.safetensors; 中文风格.safetensors"})
        self.assertTrue(self.matcher.match(params, self.rule("lora", "equals", "中文风格.safetensors")))
        self.assertFalse(self.matcher.match(params, self.rule("lora", "equals", "portrait-v2.safetensors; 中文风格.safetensors")))


if __name__ == "__main__":
    unittest.main()
