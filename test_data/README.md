# 测试素材

本目录用于本地功能与视觉验证，原媒体和运行清单不提交。数量随配置变化，不依赖某台机器已导入的记录。

| 样本                         | 覆盖                                      |
| ---------------------------- | ----------------------------------------- |
| 静态／动态图                 | 格式、透明、EXIF、缩略图、预览与图层      |
| 音视频                       | 编码、无音轨、时长、进度、封面与歌词      |
| regression-cases/01-尺寸     | 极小、奇数、大图、超宽与超长              |
| regression-cases/02-格式     | 灰度、CMYK、透明、AVIF 与 WebP            |
| regression-cases/03-文件名   | 中文、空格、emoji、特殊字符、长路径及重复 |
| regression-cases/04-生成信息 | ComfyUI、资源、工作流、大整数与零值       |
| regression-cases/05-批量     | 分页、混排、连选、标签和批量操作          |

图案与生成参数为合成样本，不代表实际 AI 输出。封面能读不代表编码能播放，不支持的生成格式用于原始元信息验证。

## 生成与导入

后端运行在 7877、FFmpeg 在 PATH，从仓库根执行：

```powershell
.\.venv\Scripts\python.exe tools/test-data/generate_test_cases.py
.\.venv\Scripts\python.exe tools/test-data/seed_test_library.py
```

生成补齐缺失文件，不覆盖已有样本，导入通过 API 注册目录、补齐标签及关联。基础音视频可用 `tools/test-data/generate_test_media.py --output test_data/basic-demos`。参数用 `--help` 查看。

导入修改当前测试媒体库，请使用隔离开发数据；自动测试另用临时资源。
