"""Generate a small, repeatable media library for manual UI testing.

Run with the project's Python environment and ffmpeg on PATH, for example:
  python scripts/generate_test_media.py --output /path/to/测试文件
  python scripts/generate_test_media.py --only audio --output test_data/demo-audio

Only the named fixtures are overwritten; other files in the output stay intact.
"""

from __future__ import annotations

import argparse
import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in (
        "/mnt/c/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/msyh.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def scene(size: tuple[int, int], theme: str, label: str, transparent: bool = False) -> Image.Image:
    width, height = size
    canvas = Image.new("RGBA", size, (0, 0, 0, 0) if transparent else "#102841")
    draw = ImageDraw.Draw(canvas)
    if not transparent:
        top, bottom = {
            "sunrise": ((27, 40, 92), (249, 180, 123)),
            "mountain": ((51, 92, 132), (192, 221, 202)),
            "sea": ((49, 152, 193), (182, 222, 231)),
            "city": ((22, 23, 56), (85, 66, 123)),
            "texture": ((24, 62, 101), (116, 194, 211)),
            "retro": ((122, 72, 110), (231, 178, 125)),
        }.get(theme, ((42, 79, 153), (178, 191, 231)))
        for y in range(height):
            ratio = y / max(1, height - 1)
            color = tuple(round(a + (b - a) * ratio) for a, b in zip(top, bottom))
            draw.line((0, y, width, y), fill=(*color, 255))
    if theme in {"sunrise", "mountain", "sea"}:
        draw.ellipse((width * .66, height * .12, width * .79, height * .12 + width * .13), fill="#ffe4a3")
        if theme == "sea":
            draw.rectangle((0, height * .57, width, height), fill="#267e9c")
            for n in range(10):
                y = height * (.61 + n * .043)
                draw.arc((-width * .15, y, width * 1.15, y + height * .15), 180, 340, fill="#b5e7e7", width=max(2, width // 340))
        else:
            draw.polygon(((0, height * .76), (width * .25, height * .30), (width * .57, height * .78)), fill="#315571")
            draw.polygon(((width * .25, height * .75), (width * .63, height * .38), (width, height * .78)), fill="#497282")
            draw.polygon(((width * .13, height * .52), (width * .25, height * .30), (width * .38, height * .52)), fill="#dce8df")
            draw.rectangle((0, height * .76, width, height), fill="#203f52")
    elif theme == "city":
        for n in range(15):
            x = n * width / 14
            roof = height * (.35 + .22 * (n % 4) / 3)
            draw.rectangle((x, roof, x + width / 19, height), fill="#18243c")
            for yy in range(int(roof + height * .03), height, max(12, height // 17)):
                draw.rectangle((x + width / 65, yy, x + width / 40, yy + height / 90), fill="#f7ca76")
    else:
        for n in range(9):
            x = width * (n + 1) / 10
            y = height * (.32 + .12 * math.sin(n * 1.7))
            radius = min(width, height) * (.09 + n % 3 * .035)
            color = ["#ffcf70", "#f36f87", "#6ee1d7", "#8f8de8"][n % 4]
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)
    text_size = max(18, min(width, height) // 24)
    draw.rounded_rectangle((width * .035, height * .82, width * .72, height * .96), radius=max(5, text_size // 3), fill=(15, 30, 49, 215))
    draw.text((width * .055, height * .85), label, font=font(text_size), fill="white")
    return canvas


def generate_images(root: Path) -> list[Path]:
    specs = [
        ("图片/风景/日出-横屏-1920x1080.jpg", (1920, 1080), "sunrise"),
        ("图片/风景/山谷-竖屏-1080x1920.png", (1080, 1920), "mountain"),
        ("图片/风景/海面-方形-1024x1024.webp", (1024, 1024), "sea"),
        ("图片/设计/城市夜景-1280x720.jpeg", (1280, 720), "city"),
        ("图片/设计/几何-小图-320x240.png", (320, 240), "geometry"),
        ("图片/设计/纹理-大图-2560x1440.jpg", (2560, 1440), "texture"),
        ("图片/设计/透明图-800x800.png", (800, 800), "geometry"),
        ("图片/设计/复古-BMP-800x600.bmp", (800, 600), "retro"),
    ]
    paths = []
    for name, size, theme in specs:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        image = scene(size, theme, path.stem, transparent="透明图" in name)
        if path.suffix.lower() in {".jpg", ".jpeg", ".bmp"}:
            image = image.convert("RGB")
        kwargs = {"quality": 88} if path.suffix.lower() in {".jpg", ".jpeg", ".webp"} else {}
        image.save(path, **kwargs)
        paths.append(path)
    animated = root / "图片/设计/动图-640x360.gif"
    frames = []
    for index in range(12):
        frame = scene((640, 360), "geometry", "GIF · 640×360")
        draw = ImageDraw.Draw(frame)
        x = 65 + index * 45
        draw.ellipse((x, 230, x + 55, 285), fill="#fff4a6")
        frames.append(frame.convert("P", palette=Image.Palette.ADAPTIVE))
    frames[0].save(animated, save_all=True, append_images=frames[1:], duration=120, loop=0, optimize=True)
    return paths + [animated]


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def generate_videos(root: Path) -> list[Path]:
    specs = [
        ("视频/横屏-H264-1280x720.mp4", "1280x720", "libx264", "aac", "440"),
        ("视频/小屏-VP9-640x360.webm", "640x360", "libvpx-vp9", "libopus", "523"),
        ("视频/竖屏-H264-720x1280.mov", "720x1280", "libx264", "aac", "659"),
        ("视频/标清-H264-320x240.mkv", "320x240", "libx264", "aac", "784"),
    ]
    paths = []
    for name, size, codec, audio_codec, tone in specs:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        codec_args = ["-c:v", codec, "-pix_fmt", "yuv420p"]
        codec_args += ["-preset", "ultrafast", "-crf", "30"] if codec == "libx264" else ["-deadline", "realtime", "-cpu-used", "6", "-b:v", "550k"]
        ffmpeg(
            "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=24",
            "-f", "lavfi", "-i", f"sine=frequency={tone}:sample_rate=44100",
            "-t", "2.5", *codec_args, "-c:a", audio_codec, "-b:a", "96k", "-shortest", str(path),
        )
        paths.append(path)
    return paths


def generate_audio(root: Path) -> list[Path]:
    specs = [
        ("音频/示例旋律-MP3-128k.mp3", "libmp3lame", 18, 44100, 2),
        ("音频/短提示音-WAV-单声道.wav", "pcm_s16le", .6, 44100, 1),
        ("音频/示例旋律-FLAC-48k.flac", "flac", 30, 48000, 2),
        ("音频/示例旋律-OGG.ogg", "libvorbis", 12, 44100, 2),
        ("音频/长音频-AAC-两分钟.m4a", "aac", 120, 44100, 2),
        ("音频/无封面/示例旋律-WAV-无封面.wav", "pcm_s16le", 8, 44100, 1),
        ("音频/左右声道-Opus.ogg", "libopus", 24, 48000, 2),
        ("音频/无封面/静音-WAV.wav", "pcm_s16le", 3, 44100, 1),
    ]
    cover = root / "音频/cover.jpg"
    cover.parent.mkdir(parents=True, exist_ok=True)
    scene((600, 600), "geometry", "TEST AUDIO").convert("RGB").save(cover, quality=85)
    paths = []
    for name, codec, duration, sample_rate, channels in specs:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        # A quiet repeating scale with soft attack/release, rather than a constant test beep.
        melody = f"0.12*sin(2*PI*220*pow(2,mod(floor(t*4),8)/12)*t)*min(1,t*8)*min(1,({duration}-t)*4)"
        if "静音" in name:
            melody = "0"
        elif "左右声道" in name:
            melody = f"{melody}*lt(mod(t,4),2)|{melody}*gte(mod(t,4),2)"
        inputs = ["-f", "lavfi", "-i", f"aevalsrc='{melody}':s={sample_rate}:d={duration}"]
        cover_args = []
        if codec == "libmp3lame":
            inputs += ["-i", str(cover)]
            cover_args = ["-map", "0:a", "-map", "1:v", "-c:v", "copy", "-disposition:v", "attached_pic", "-id3v2_version", "3"]
        bitrate_args = ["-b:a", "128k"] if codec in {"libmp3lame", "aac", "libopus"} else []
        ffmpeg(
            *inputs, *cover_args, "-ac", str(channels), "-c:a", codec, *bitrate_args,
            "-metadata", f"title={path.stem}", "-metadata", "artist=万象馆测试", "-metadata", "album=测试文件",
            str(path),
        )
        paths.append(path)
    (root / "音频/示例旋律-MP3-128k.lrc").write_text(
        "[ti:万象馆音频测试]\n[ar:万象馆测试]\n[00:00.00]万象馆音频测试\n[00:04.00]这一段用于检查歌词显示\n[00:08.00]拖动进度条，检查时间同步\n[00:12.00]切换音量和播放状态\n[00:16.00]测试即将结束\n", encoding="utf-8"
    )
    return paths + [cover]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--only", choices=["all", "audio"], default="all", help="Generate only audio fixtures without touching images or videos")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        parser.error("ffmpeg is required on PATH")
    root = args.output.resolve()
    root.mkdir(parents=True, exist_ok=True)
    paths = generate_audio(root) if args.only == "audio" else generate_images(root) + generate_videos(root) + generate_audio(root)
    (root / "样本说明.txt").write_text(
        ("万象馆音频测试文件：8 段合成音频，时长 0.6 秒至 2 分钟，覆盖 MP3、WAV、FLAC、OGG、AAC、Opus。\n"
         "包含单／双声道、左右声道交替、静音、MP3 内嵌封面、独立封面、LRC 时间歌词，以及无封面样本。\n"
         if args.only == "audio" else "万象馆媒体测试文件。包含不同格式和尺寸的图片、短视频、音频；另有无封面音频用于检查纯色占位。\n") +
        "这些文件由 scripts/generate_test_media.py 生成，重新运行只覆盖同名样本文件。\n",
        encoding="utf-8",
    )
    for path in paths:
        print(f"{path.relative_to(root)}\t{path.stat().st_size} bytes")
    print(f"Generated {len(paths)} media files in {root}")


if __name__ == "__main__":
    main()
