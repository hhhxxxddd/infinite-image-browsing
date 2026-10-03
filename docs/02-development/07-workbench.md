# 工作台实现

[文档导航](../README.md) · [使用指南](../01-user-guide/02-workbench.md) · [架构与性能](05-architecture-performance.md)

WorkbenchPage 组合工作区、作品、制作文件、素材及成果，EditorHub 根据工具和 draftId 进入编辑器。模型与仓储在 `frontend/src/features/workspaces/model`。

## 数据契约

| 数据                     | 来源／保存                                      |
| ------------------------ | ----------------------------------------------- |
| 工作区与共享引用         | workbench_projects 设置，workspaceModel 校验    |
| 作品、制作文件、编辑文档 | react/shared/workspaceState.ts 版本事务与纯仓储 |
| 产物／快照               | /api/workspace_artifacts、/api/workspace_inputs |
| 媒体选择                 | 搜索／筛选接口，保存路径引用                    |
| 成果                     | 作品选定产物，媒体库同步另建副本                |

工作区偏好用 localStorage，作品用标签页 sessionStorage；返回工作区或切换工作区清除作品选择。制作数据通过共享订阅与事务同步。

颜色由 workspaceColor 校验，未设按 ID 分配。创建、修改与使用时间分开；更新排序包含制作文件日期，打开或媒体新建制作更新最近使用，不改创建日期。

## 交互与加载

工作区／作品标题与返回共用布局。三种卡片区分层级，引用／产物渐进加载，切换取消旧请求。两级排序独立保存，无效日期置后。

MaterialBar 共用范围、类型、来源、预览和动作，范围为空也保留底座。滚轮在 DOM 中跟随与回弹，卸载释放监听、动画和观察器；浏览网格虚拟化，选择避免重绘无关卡片。

WorkbenchSkyBackdrop 独立轮换，隐藏、离开或减少动态效果时暂停，不重绘工作区卡片，见 [资源说明](../../frontend/react/features/workbench/assets/README.md)。

媒体制作使用 CreateMediaDraftDialog／mediaDraftModel，支持已有与新建工作区、作品。提交重读权限与目标，稳定 ID 可重试；文档、索引和引用状态事务提交，失败回滚，成功才进入编辑器。

## 保存与产物

图片会话复用持久仓储和串行保存队列，版本及渲染规则见[图片编辑实现](06-image-editor.md)。音视频保存各自版本时间线，AI 保存用途、配置与输入关联。切换编辑上下文等待保存，失败保留原页。

编辑分支固定快照和来源，生成不建立图片输入。每张 AI 结果独立记录，批次可部分成功，归属不随页面转移。

删除清理所属文档和快照关联，产物删除清理成果／AI 引用；不删除已同步媒体副本。事务及备份边界见[架构与性能](05-architecture-performance.md#持久化与任务)。

回归覆盖空素材、超过首批、切换／失败、返回、排序、冲突和成果同步；真实服务可用性单独验证。
