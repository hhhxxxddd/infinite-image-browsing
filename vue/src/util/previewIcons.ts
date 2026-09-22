import { h, type Component } from 'vue'
import {
  CloseOutlined, LeftOutlined, RightOutlined, RotateLeftOutlined,
  RotateRightOutlined, SwapOutlined, ZoomInOutlined, ZoomOutOutlined
} from '@ant-design/icons-vue'

const tool = (label: string, icon: Component, rotate = 0) => h('button', {
  type: 'button', class: 'preview-image-tool', title: label, 'aria-label': label
}, [h(icon, { rotate }), h('span', label)])

// Keep the preview component's native transforms and add readable controls.
export const previewIcons = {
  close: tool('关闭', CloseOutlined),
  zoomIn: tool('放大', ZoomInOutlined),
  zoomOut: tool('缩小', ZoomOutOutlined),
  rotateLeft: tool('向左旋转', RotateLeftOutlined),
  rotateRight: tool('向右旋转', RotateRightOutlined),
  flipX: tool('水平翻转', SwapOutlined),
  flipY: tool('垂直翻转', SwapOutlined, 90),
  left: h(LeftOutlined),
  right: h(RightOutlined)
}
