# 04 · 嵌入集成

[文档首页](../README.md) · [开发指南](01-development.md)

当前只支持同源页面展示及用户在嵌入页面内操作：

```html
<iframe src="/" title="OmniGallery" style="width:100%;height:100vh;border:0"></iframe>
```

后端入口为 `omnigallery.app:create_app`，先构建 `frontend/dist`。嵌入与普通页面使用同一认证、目录权限和 `/api` 路径。

不提供父页面脚本桥、内部状态或组件实例接口，也不接受自定义 API 前缀。如需程序化控制，须另行定义有来源校验、版本和数据契约的消息协议，不能复用已删除的旧全局函数。
