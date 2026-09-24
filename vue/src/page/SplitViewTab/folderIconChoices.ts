import type { Component } from 'vue'
import {
  AppstoreOutlined, BgColorsOutlined, BookOutlined, CameraOutlined,
  FolderOutlined, HddOutlined, HeartOutlined, HomeOutlined,
  InboxOutlined, CustomerServiceOutlined, PictureOutlined, StarOutlined,
  TagOutlined, VideoCameraOutlined,
} from '@ant-design/icons-vue'

export const iconChoices: { id: string; label: string; icon: Component }[] = [
  { id: 'folder', label: '文件夹', icon: FolderOutlined },
  { id: 'disk', label: '磁盘', icon: HddOutlined },
  { id: 'photo', label: '图片', icon: PictureOutlined },
  { id: 'video', label: '视频', icon: VideoCameraOutlined },
  { id: 'camera', label: '相机', icon: CameraOutlined },
  { id: 'star', label: '收藏', icon: StarOutlined },
  { id: 'heart', label: '喜欢', icon: HeartOutlined },
  { id: 'book', label: '图册', icon: BookOutlined },
  { id: 'archive', label: '归档', icon: InboxOutlined },
  { id: 'work', label: '项目', icon: AppstoreOutlined },
  { id: 'music', label: '音乐', icon: CustomerServiceOutlined },
  { id: 'palette', label: '设计', icon: BgColorsOutlined },
  { id: 'tag', label: '分类', icon: TagOutlined },
  { id: 'home', label: '个人', icon: HomeOutlined },
]

export function storedFolderIcon(icons: Record<string, string>, path: string, isWin?: boolean): string {
  if (icons[path]) return icons[path]
  const normalize = (value: string) => {
    const result = value.replace(/\\/g, '/').replace(/\/+$/, '')
    return isWin ? result.toLocaleLowerCase() : result
  }
  return Object.entries(icons).find(([key]) => normalize(key) === normalize(path))?.[1] || ''
}
