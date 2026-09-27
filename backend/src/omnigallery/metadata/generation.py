import json
import os
import re
import struct

import piexif
import piexif.helper
from PIL import Image

from omnigallery.infrastructure.collections import unique_by
from omnigallery.infrastructure.formatting import unquote


def get_img_geninfo_txt_path(path: str):
    txt_path = re.sub(r"\.\w+$", ".txt", path)
    if os.path.exists(txt_path):
        return txt_path


def _extract_usercomment_from_raw_exif(exif_bytes: bytes):
    """Fallback: extract UserComment (tag 0x9286) from raw EXIF bytes when piexif fails."""
    try:
        if exif_bytes[:6] != b"Exif\x00\x00" or len(exif_bytes) < 14:
            return None
        bo = exif_bytes[6:8]
        if bo == b"MM":
            fmt_h, fmt_i = ">H", ">I"
        elif bo == b"II":
            fmt_h, fmt_i = "<H", "<I"
        else:
            return None
        ifd0_off = struct.unpack(fmt_i, exif_bytes[10:14])[0]
        pos = 6 + ifd0_off
        if pos + 2 > len(exif_bytes):
            return None
        num = struct.unpack(fmt_h, exif_bytes[pos : pos + 2])[0]
        for i in range(num):
            ep = pos + 2 + i * 12
            if ep + 12 > len(exif_bytes):
                break
            tag = struct.unpack(fmt_h, exif_bytes[ep : ep + 2])[0]
            if tag == 0x9286:
                count = struct.unpack(fmt_i, exif_bytes[ep + 4 : ep + 8])[0]
                val = struct.unpack(fmt_i, exif_bytes[ep + 8 : ep + 12])[0]
                if count <= 4:
                    return exif_bytes[ep + 8 : ep + 8 + count]
                dp = 6 + val
                return exif_bytes[dp : dp + count] if dp + count <= len(exif_bytes) else None
        return None
    except Exception:
        return None


def read_generation_parameters_from_image(media: Image, path="") -> str:
    """
    Reads metadata from an image file.

    Args:
        image (PIL.Image.Image): The image object to read metadata from.
        path (str): Optional. The path to the image file. Used to look for a .txt file with additional metadata.

    Returns:
        str: The metadata as a string.
    """
    items = media.info or {}
    geninfo = items.pop("parameters", None)
    if "exif" in items:
        exif = piexif.load(items["exif"])
        exif_comment = (exif or {}).get("Exif", {}).get(piexif.ExifIFD.UserComment, b"")

        try:
            exif_comment = piexif.helper.UserComment.load(exif_comment)
        except ValueError:
            exif_comment = exif_comment.decode("utf8", errors="ignore")

        if exif_comment:
            items["exif comment"] = exif_comment
            geninfo = exif_comment
        elif not geninfo:
            raw = _extract_usercomment_from_raw_exif(items["exif"])
            if raw:
                try:
                    exif_comment = raw.decode("utf-16", errors="ignore").strip("\x00")
                except Exception:
                    exif_comment = raw.decode("utf-8", errors="ignore").strip("\x00")
                if exif_comment:
                    items["exif comment"] = exif_comment
                    geninfo = exif_comment

    if not geninfo and path:
        try:
            txt_path = get_img_geninfo_txt_path(path)
            if txt_path:
                with open(txt_path) as f:
                    geninfo = f.read()
        except Exception:
            pass

    return geninfo


re_param_code = r'\s*([\w ]+):\s*("(?:\\"[^,]|\\"|\\|[^\"])+"|[^,]*)(?:,|$)'


re_param = re.compile(re_param_code)


re_imagesize = re.compile(r"^(\d+)x(\d+)$")


re_lora_prompt = re.compile(r"<lora:([^:>]+)(?::([-+]?(?:\d+(?:\.\d*)?|\.\d+)))?>", re.IGNORECASE)


re_lora_extract = re.compile(r"([\w_\s.-]+)(?:\d+)?")


re_lyco_prompt = re.compile(r"<lyco:([^:>]+):([-+]?(?:\d+(?:\.\d*)?|\.\d+))>", re.IGNORECASE)


re_parens = re.compile(r"[\\/\[\](){}]+")


def lora_extract(lora: str):
    """
    提取yoshino yoshino(2a79aa5adc4a)
    """
    res = re_lora_extract.match(lora)
    return res.group(1) if res else lora


def parse_prompt(x: str):
    # Capture resource names before normalizing separators in ordinary prompt tags.
    lora_list = [
        {"name": match.group(1).strip(), "value": float(match.group(2) or 1.0)}
        for match in re_lora_prompt.finditer(x)
    ]
    lyco_list = [
        {"name": match.group(1).strip(), "value": float(match.group(2))}
        for match in re_lyco_prompt.finditer(x)
    ]
    x = re_lora_prompt.sub("", x)
    x = re_lyco_prompt.sub("", x)
    x = re.sub(r"\sBREAK\s", " , BREAK , ", x)
    x = x.replace("，", ",").replace("-", " ").replace("_", " ")
    x = re.sub(re_parens, "", x)
    tag_list = [x.strip() for x in x.split(",")]
    res = []
    for tag in tag_list:
        if len(tag) == 0:
            continue
        idx_colon = tag.find(":")
        if idx_colon != -1:
            tag = tag[0:idx_colon]
            if len(tag):
                res.append(tag.lower())
        else:
            res.append(tag.lower())
    return {"pos_prompt": res, "lora": lora_list, "lyco": lyco_list}


def parse_generation_parameters(x: str):
    res = {}
    prompt = ""
    negative_prompt = ""
    done_with_prompt = False
    if not x:
        return {"meta": {}, "pos_prompt": [], "lora": [], "lyco": []}

    # 提取并混入 extraJsonMetaInfo 字段
    extra_json_match = re.search(r"\nextraJsonMetaInfo:\s*(\{[\s\S]*\})\s*$", x.strip())
    if extra_json_match:
        try:
            extra_json_meta_info = json.loads(extra_json_match.group(1))
            # 混入到 res 中，确保所有值都是字符串
            for k, v in extra_json_meta_info.items():
                res[k] = json.dumps(v) if not isinstance(v, str) else v
            # 从原始参数中移除 extraJsonMetaInfo 部分
            x = re.sub(r"\nextraJsonMetaInfo:\s*\{[\s\S]*\}\s*$", "", x.strip())
        except json.JSONDecodeError:
            # 解析失败，保留原始字符串
            pass

    *lines, lastline = x.strip().split("\n")
    if len(re_param.findall(lastline)) < 3:
        lines.append(lastline)
        lastline = ""
    if len(lines) == 1 and lines[0].startswith("Postprocess"):  # 把上面改成<2应该也可以，当时不敢动
        lastline = lines[
            0
        ]  # 把Postprocess upscale by: 4, Postprocess upscaler: R-ESRGAN 4x+ Anime6B 推到res解析
        lines = []
    for _i, line in enumerate(lines):
        line = line.strip()
        if line.startswith("Negative prompt:"):
            done_with_prompt = True
            line = line[16:].strip()

        if done_with_prompt:
            negative_prompt += ("" if negative_prompt == "" else "\n") + line
        else:
            prompt += ("" if prompt == "" else "\n") + line

    for k, v in re_param.findall(lastline):
        try:
            if len(v) == 0:
                res[k] = v
                continue
            if v[0] == '"' and v[-1] == '"':
                v = unquote(v)

            m = re_imagesize.match(v)
            if m is not None:
                res[f"{k}-1"] = m.group(1)
                res[f"{k}-2"] = m.group(2)
            else:
                res[k] = v
        except Exception:
            print(f'Error parsing "{k}: {v}"')

    prompt_parse_res = parse_prompt(prompt)
    lora = prompt_parse_res["lora"]
    for name in str(res.get("LoRA") or res.get("Lora") or "").split(";"):
        if name.strip():
            lora.append({"name": name.strip(), "value": 1.0})
    for k in res:
        k_s = str(k)
        if k_s.startswith("AddNet Module") and str(res[k]).lower() == "lora":
            model = res[k_s.replace("Module", "Model")]
            value = res.get(k_s.replace("Module", "Weight A"), "1")
            lora.append({"name": lora_extract(model), "value": float(value)})
    return {
        "meta": res,
        "pos_prompt": unique_by(prompt_parse_res["pos_prompt"]),
        "lora": unique_by(lora, lambda x: x["name"].lower()),
        "lyco": unique_by(prompt_parse_res["lyco"], lambda x: x["name"].lower()),
    }
