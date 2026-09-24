from typing import List, Dict, Any, Optional
import re
from scripts.iib.db.datamodel import GlobalSetting, Tag, ImageTag
from scripts.iib.logger import logger
from scripts.iib.parsers.model import ImageGenerationParams

class AutoTagMatcher:
    _instance: Optional['AutoTagMatcher'] = None
    
    def __init__(self, conn):
        self.conn = conn
        self.rules = self.load_rules()

    @classmethod
    def get_instance(cls, conn) -> 'AutoTagMatcher':
        """获取全局单例实例"""
        if cls._instance is None:
            cls._instance = cls(conn)
        else:
            # 更新连接
            cls._instance.conn = conn
        return cls._instance
    
    @classmethod
    def reload_rules(cls, conn) -> None:
        """重新加载规则"""
        if cls._instance is not None:
            cls._instance.conn = conn
            cls._instance.rules = cls._instance.load_rules()

    def load_rules(self) -> List[Dict[str, Any]]:
        try:
            setting = GlobalSetting.get_setting(self.conn, "auto_tag_rules")
            print("Loaded auto tag rules:", setting)
            if setting:
                return setting
        except Exception as e:
            logger.error(f"Error loading auto tag rules: {e}")
        return []

    def match(self, params: ImageGenerationParams, rule: Dict[str, Any]) -> bool:
        # params is ImageGenerationParams
        # rule structure: { "tag": "TagName", "filters": [...] }
        # filter structure: { "field": "pos_prompt", "operator": "contains", "value": "foo" }
        
        filters = rule.get("filters", [])
        if not filters:
            return False

        for filter in filters:
            field = filter.get("field")
            operator = filter.get("operator")
            value = filter.get("value")
            
            target_values = []
            if field == "pos_prompt":
                target_values = [",".join(params.pos_prompt) if isinstance(params.pos_prompt, list) else str(params.pos_prompt)]
            elif field == "neg_prompt":
                target_values = [params.extra.get("neg_prompt_raw") or params.meta.get("Negative prompt", "")]
            elif field == "lora":
                # A file can use several LoRAs. Match each name independently so
                # "equals" means an exact resource name, not the joined list.
                loras = params.extra.get("lora", [])
                if isinstance(loras, list):
                    target_values = [item.get("name", "") if isinstance(item, dict) else item for item in loras]
                elif isinstance(loras, str):
                    target_values = [name.strip() for name in loras.split(";")]
                if not target_values:
                    target_values = [name.strip() for name in str(params.meta.get("LoRA", "")).split(";")]
            else:
                target_value = params.meta.get(field, "")
                if not target_value and field in params.extra:
                    target_value = params.extra.get(field, "")
                target_values = [target_value]
            
            target_values = [str(item) for item in target_values if item is not None and str(item).strip()]
            if not target_values:
                return False

            if operator == "contains":
                if not any(value.lower() in target.lower() for target in target_values):
                    return False
            elif operator == "equals":
                if not any(value.lower() == target.lower() for target in target_values):
                    return False
            elif operator == "regex":
                try:
                    if not any(re.search(value, target, re.IGNORECASE) for target in target_values):
                        return False
                except re.error:
                    return False
            # Add more operators if needed
            
        return True

    def apply(self, img_id: int, params: Any):
        if not self.rules:
            return
            
        for rule in self.rules:
            try:
                if self.match(params, rule):
                    tag_name = rule.get("tag")
                    if tag_name:
                        tag = Tag.get_or_create(self.conn, tag_name, "custom")
                        if tag:
                            ImageTag(img_id, tag.id).save_or_ignore(self.conn)
            except Exception as e:
                logger.error(f"Error applying auto tag rule {rule}: {e}")
