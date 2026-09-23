# 在 FastAPI 应用中嵌入拾影

独立桌面版和普通网页不需要此接口。只有在同源 iframe 中嵌入前端，并显式启用 `export_fe_fn` 时，父页面才能调用前端导出的函数。

```python
from fastapi import FastAPI
from app import AppUtils

app = FastAPI()
AppUtils(base="/media", export_fe_fn=True).wrap_app(app)
```

```html
<iframe id="media-library" src="/media"></iframe>
```

在 iframe 初始化完成后，可使用 `createGridViewFile` 创建临时媒体集合；这不会把文件加入扫描索引：

```js
const frame = document.querySelector('#media-library').contentWindow
const files = [
  frame.createGridViewFile('/path/to/a.jpg', ['参考']),
  frame.createGridViewFile('/path/to/b.jpg')
]

const view = frame.insertTabPane({
  pane: {
    type: 'grid-view',
    name: '候选图片',
    files,
    removable: true,
    allowDragAndDrop: false
  }
})

const openPanes = frame.getTabList()[0].panes
view.ref.close()
```

目前还导出 `getPageRef`、`setTags`、`getTags`、`setTagColor` 与 `openIIBInNewTab`。类型定义见 [useGlobalStore.ts](src/store/useGlobalStore.ts)，实现见 [defineExportFunc.ts](src/defineExportFunc.ts)。旧版标签搜索、模糊搜索及独立结果页已移除，不再通过 `insertTabPane` 支持这些视图类型。
