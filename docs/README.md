# 星空馆文档

文档描述当前实现。安装见[项目 README](../README.md)，配置见 [环境示例](../.env.example)。操作、界面约定和实现契约分别维护，避免同一规则在多处重复。

## 使用

| 文档                                        | 内容                                     |
| ------------------------------------------- | ---------------------------------------- |
| [媒体库](01-user-guide/01-media-library.md) | 收录、目录、搜索、预览、标签和文件操作   |
| [工作台](01-user-guide/02-workbench.md)     | 工作区、图片编辑、音视频制作、产物和成果 |
| [AI 接入](01-user-guide/03-ai-services.md)  | 模型、运行环境、在线服务与边界           |
| [存储与备份](01-user-guide/04-storage.md)   | 统一目录、迁移、占用、缓存清理与恢复     |

## 开发

| 文档                                                        | 内容                                   |
| ----------------------------------------------------------- | -------------------------------------- |
| [开发指南](02-development/01-development.md)                | 环境、命令、目录、检查与打包           |
| [代码规范](02-development/02-coding-standards.md)           | 模块、状态、错误与测试约定             |
| [设计系统](02-development/03-design-system.md)              | 主题、布局、控件与交互层级             |
| [嵌入集成](02-development/04-embedding.md)                  | 同源 iframe 与接口边界                 |
| [架构与性能](02-development/05-architecture-performance.md) | 事务、缓存、容量与基准                 |
| [图片编辑实现](02-development/06-image-editor.md)           | 变换预览、渲染、版本与快照             |
| [工作台实现](02-development/07-workbench.md)                | 状态、导航、素材与保存契约             |
| [视频编辑实现](02-development/08-video-editor.md)           | 时间线、预览、FFmpeg 与限制            |
| [应用存储实现](02-development/09-storage.md)                | 启动定位、目录契约、升级迁移与清理边界 |

[更新记录](04-changelog.md) · [测试素材](../test_data/README.md)
