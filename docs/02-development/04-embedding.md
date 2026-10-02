# 嵌入集成

[文档导航](../README.md) · [开发指南](01-development.md)

支持同源 iframe，用户在嵌入页中操作：

```html
<iframe
  src="/"
  title="OmniGallery"
  style="width:100%;height:100vh;border:0"
></iframe>
```

后端工厂是 `omnigallery.app:create_app`，服务前构建 `frontend/dist`。嵌入使用相同认证、目录权限与 `/api`。

不提供父页面脚本桥、组件实例或内部状态接口，不接受自定义 API 前缀。程序控制需要另定义带来源校验和版本的数据协议。
