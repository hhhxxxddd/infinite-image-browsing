"""Bundled Qwen 2.1 graph, adapted from the supplied local-edit workflow."""

import copy

_GRAPH = {
    "1": {"inputs": {"image": ""}, "class_type": "LoadImage"},
    "2": {
        "inputs": {"filename_prefix": "qwen_erase/image", "images": ["15", 0]},
        "class_type": "SaveImage",
    },
    "3": {
        "inputs": {"value": "移除涂抹区域内的物体，根据周围环境自然补全，保持画面风格和光照一致。"},
        "class_type": "PrimitiveStringMultiline",
    },
    "4": {
        "inputs": {
            "unet_name": "qwen_image_2.1_int8_convrot.safetensors",
            "weight_dtype": "default",
        },
        "class_type": "UNETLoader",
    },
    "5": {
        "inputs": {
            "clip_name": "qwen3vl_8b_int8_convrot.safetensors",
            "type": "qwen_image",
            "device": "default",
        },
        "class_type": "CLIPLoader",
    },
    "6": {"inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}, "class_type": "VAELoader"},
    "7": {
        "inputs": {"device": "auto", "dtype": "default", "model": ["4", 0]},
        "class_type": "QwenImage21Cache",
    },
    "8": {
        "inputs": {
            "downscale_algorithm": "bilinear",
            "upscale_algorithm": "bicubic",
            "preresize": False,
            "preresize_mode": "ensure minimum resolution",
            "preresize_min_width": 1024,
            "preresize_min_height": 1024,
            "preresize_max_width": 16384,
            "preresize_max_height": 16384,
            "mask_fill_holes": False,
            "mask_expand_pixels": 0,
            "mask_invert": False,
            "mask_blend_pixels": 16,
            "mask_hipass_filter": 0.0,
            "extend_for_outpainting": False,
            "extend_up_factor": 1,
            "extend_down_factor": 1,
            "extend_left_factor": 1,
            "extend_right_factor": 1,
            "context_from_mask_extend_factor": 1.0,
            "output_resize_to_target_size": True,
            "output_target_width": 512,
            "output_target_height": 512,
            "output_padding": "32",
            "image": ["1", 0],
            "mask": ["16", 0],
            "device_mode": "cpu (compatible)",
            "optional_context_mask": ["17", 0],
        },
        "class_type": "InpaintCropImproved",
    },
    "9": {
        "inputs": {
            "prompt": ["3", 0],
            "negative_prompt": "artifacts, gpt-image, washed-out colors, low quality, "
            "low resolution, AI slop, deviantart, sloppy lines, rough "
            "sketch, blurry, indistinct, missing fingers, badly drawn "
            "hands, wrong number of fingers",
            "resolution": 0,
            "clip": ["5", 0],
            "images.image_1": ["8", 1],
            "vae": ["6", 0],
        },
        "class_type": "TextEncodeQwenImage21",
    },
    "10": {"inputs": {"pixels": ["8", 1], "vae": ["6", 0]}, "class_type": "VAEEncode"},
    "11": {"inputs": {"samples": ["10", 0], "mask": ["8", 2]}, "class_type": "SetLatentNoiseMask"},
    "12": {
        "inputs": {
            "seed": 700823596971653,
            "steps": 25,
            "cfg": 1,
            "sampler_name": "euler",
            "scheduler": "simple",
            "denoise": 1,
            "model": ["7", 0],
            "positive": ["9", 0],
            "negative": ["9", 1],
            "latent_image": ["11", 0],
        },
        "class_type": "KSampler",
    },
    "13": {"inputs": {"samples": ["12", 0], "vae": ["6", 0]}, "class_type": "VAEDecode"},
    "14": {"inputs": {"image": ["13", 0]}, "class_type": "SplitImageWithAlpha"},
    "15": {
        "inputs": {"stitcher": ["8", 0], "inpainted_image": ["14", 0]},
        "class_type": "InpaintStitchImproved",
    },
    "16": {"class_type": "LoadImageMask", "inputs": {"image": "", "channel": "red"}},
    "17": {"class_type": "LoadImageMask", "inputs": {"image": "", "channel": "red"}},
}


def erase_workflow():
    return copy.deepcopy(_GRAPH)
