import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { LocaleContext, type LocaleContextValue } from './languageContext'
import { patchServerPreferences } from '../features/settings/serverPreferences'
import { zhHans } from '../../src/shared/i18n/zh-hans'
import { zhHant } from '../../src/shared/i18n/zh-hant'
import { en } from '../../src/shared/i18n/en'
import { de } from '../../src/shared/i18n/de'

export type AppLanguage = 'zhHans' | 'zhHant' | 'en' | 'de'
const languages: AppLanguage[] = ['zhHans', 'zhHant', 'en', 'de']
export const languageOptions = [
  { value: 'zhHans', label: '简体中文' },
  { value: 'zhHant', label: '繁體中文' },
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' }
] as const

// Existing translations stay shared with the legacy entry; React-specific labels follow.
const ui = {
  brandSubtitle: [
    '收藏所爱，创作所想',
    '收藏所愛，創作所想',
    'Collect and create',
    'Sammeln und gestalten'
  ],
  mediaLibrary: ['媒体库', '媒體庫', 'Media Library', 'Mediathek'],
  allMedia: ['全部媒体', '全部媒體', 'All media', 'Alle Medien'],
  folders: ['目录', '目錄', 'Folders', 'Ordner'],
  openedTabs: ['已打开的标签', '已開啟的分頁', 'Open tabs', 'Geöffnete Tabs'],
  expandOpenedTabs: [
    '展开已打开标签',
    '展開已開啟分頁',
    'Expand open tabs',
    'Geöffnete Tabs aufklappen'
  ],
  collapseOpenedTabs: [
    '收起已打开标签',
    '收起已開啟分頁',
    'Collapse open tabs',
    'Geöffnete Tabs zuklappen'
  ],
  closeView: ['关闭视图', '關閉檢視', 'Close view', 'Ansicht schließen'],
  comparisonTitle: ['图片对比', '圖片對比', 'Image comparison', 'Bildvergleich'],
  video: ['视频', '影片', 'Video', 'Video'],
  creation: ['创作', '創作', 'Create', 'Gestalten'],
  workbench: ['工作台', '工作台', 'Workbench', 'Arbeitsbereich'],
  discover: ['挑一挑', '挑一挑', 'Discover', 'Entdecken'],
  settings: ['设置', '設定', 'Settings', 'Einstellungen'],
  mainNavigation: ['主导航', '主導航', 'Main navigation', 'Hauptnavigation'],
  pages: ['页面', '頁面', 'Pages', 'Seiten'],
  expandSidebar: ['展开侧边栏', '展開側邊欄', 'Expand sidebar', 'Seitenleiste öffnen'],
  collapseSidebar: ['收起侧边栏', '收起側邊欄', 'Collapse sidebar', 'Seitenleiste schließen'],
  switchLight: ['切换浅色外观', '切換淺色外觀', 'Switch to light mode', 'Helles Design aktivieren'],
  switchDark: ['切换深色外观', '切換深色外觀', 'Switch to dark mode', 'Dunkles Design aktivieren'],
  loadingPage: ['正在加载页面…', '正在載入頁面…', 'Loading page…', 'Seite wird geladen…'],
  loadingEditor: ['正在打开编辑器', '正在開啟編輯器', 'Opening editor', 'Editor wird geöffnet'],
  pageUnavailable: [
    '页面暂时无法显示',
    '頁面暫時無法顯示',
    'This page is unavailable',
    'Diese Seite ist nicht verfügbar'
  ],
  pageUnavailableHint: [
    '请刷新页面重试，或通过侧边栏切换到其他页面。',
    '請重新整理頁面，或從側邊欄切換到其他頁面。',
    'Refresh the page or choose another page from the sidebar.',
    'Laden Sie die Seite neu oder wählen Sie eine andere Seite.'
  ],
  reloadPage: ['刷新页面', '重新整理頁面', 'Refresh page', 'Seite neu laden'],
  serverKeyTitle: [
    '需要服务器密钥',
    '需要伺服器金鑰',
    'Server key required',
    'Serverschlüssel erforderlich'
  ],
  serverKeyHint: [
    '请输入当前服务器的访问密钥以继续连接。',
    '請輸入目前伺服器的存取金鑰以繼續連線。',
    'Enter the server access key to continue.',
    'Geben Sie den Serverschlüssel ein, um fortzufahren.'
  ],
  accessKey: ['访问密钥', '存取金鑰', 'Access key', 'Zugriffsschlüssel'],
  continue: ['继续', '繼續', 'Continue', 'Weiter'],
  settingsDescription: [
    '管理应用、运行环境与创作服务。',
    '管理應用程式、執行環境與創作服務。',
    'Manage the app, runtime and creation services.',
    'App, Laufzeit und Kreativdienste verwalten.'
  ],
  general: ['通用', '一般', 'General', 'Allgemein'],
  appearance: ['外观', '外觀', 'Appearance', 'Darstellung'],
  browse: ['浏览与预览', '瀏覽與預覽', 'Browsing and preview', 'Durchsuchen und Vorschau'],
  tagConfiguration: ['标签配置', '標籤設定', 'Tags', 'Tags'],
  runtime: ['运行环境', '執行環境', 'Runtime', 'Laufzeit'],
  aiAccess: ['AI 接入', 'AI 連線', 'AI services', 'KI-Dienste'],
  shortcuts: ['快捷键', '快速鍵', 'Shortcuts', 'Tastenkürzel'],
  syncSettings: ['同步设置', '同步設定', 'Sync', 'Synchronisierung'],
  colorMode: ['颜色模式', '色彩模式', 'Color mode', 'Farbmodus'],
  light: ['浅色', '淺色', 'Light', 'Hell'],
  dark: ['深色', '深色', 'Dark', 'Dunkel'],
  system: ['跟随系统', '跟隨系統', 'System', 'System'],
  appearanceTitle: ['界面外观', '介面外觀', 'Interface appearance', 'Oberfläche'],
  appearanceDescription: [
    '媒体库与编辑器共用一套字体、间距和操作状态。',
    '媒體庫與編輯器共用一套字體、間距和操作狀態。',
    'The media library and editors share typography, spacing and interaction states.',
    'Mediathek und Editoren teilen Schrift, Abstände und Interaktionszustände.'
  ],
  appearanceNote: [
    '跟随系统会按系统外观自动切换。',
    '跟隨系統會依系統外觀自動切換。',
    'System follows your operating system appearance.',
    'System folgt der Darstellung des Betriebssystems.'
  ],
  interfaceNote: ['界面说明', '介面說明', 'Interface notes', 'Hinweise zur Oberfläche'],
  interfaceNoteDescription: [
    '新的设计语言优先突出素材本身，降低无关颜色对内容的干扰。',
    '新的設計語言優先突顯素材本身，減少無關色彩的干擾。',
    'The interface gives media prominence and reduces distracting colors.',
    'Die Oberfläche hebt Medien hervor und reduziert ablenkende Farben.'
  ],
  contentFirst: [
    '专注内容的操作界面',
    '專注內容的操作介面',
    'A content-focused workspace',
    'Ein inhaltsorientierter Arbeitsbereich'
  ],
  contentFirstNote: [
    '相同操作在不同页面保持一致的尺寸、色彩和反馈。',
    '相同操作在不同頁面維持一致的尺寸、色彩和回饋。',
    'Common actions keep the same size, color and feedback across pages.',
    'Gleiche Aktionen behalten Größe, Farbe und Rückmeldung auf allen Seiten.'
  ],
  secondaryAction: ['次要操作', '次要操作', 'Secondary action', 'Sekundäre Aktion'],
  primaryAction: ['主要操作', '主要操作', 'Primary action', 'Primäre Aktion'],
  fixedShortcuts: [
    '当前固定快捷键；在对应界面生效。',
    '目前固定快速鍵；在對應介面生效。',
    'Fixed shortcuts currently active in the named view.',
    'Feste Tastenkürzel für die jeweilige Ansicht.'
  ],
  action: ['操作', '操作', 'Action', 'Aktion'],
  location: ['位置', '位置', 'Location', 'Bereich'],
  mediaListPreview: [
    '媒体列表和预览',
    '媒體清單與預覽',
    'Media list and preview',
    'Medienliste und Vorschau'
  ],
  imageStudio: ['图片制作', '圖片製作', 'Image editor', 'Bildeditor'],
  aiImageEdit: ['AI 图片编辑', 'AI 圖片編輯', 'AI image editing', 'KI-Bildbearbeitung'],
  basicActions: ['基础与操作', '基本與操作', 'Basics and actions', 'Grundlagen und Aktionen'],
  projectDataDirectory: [
    '项目数据目录',
    '專案資料目錄',
    'Project data directory',
    'Projektverzeichnis'
  ],
  archiveDirectory: ['归档目录', '封存目錄', 'Archive directory', 'Archivverzeichnis'],
  networkProxy: ['网络代理', '網路代理', 'Network proxy', 'Netzwerkproxy'],
  ffmpegRuntime: [
    '音视频运行环境 · FFmpeg',
    '影音執行環境 · FFmpeg',
    'Media runtime · FFmpeg',
    'Medienlaufzeit · FFmpeg'
  ],
  pytorchRuntime: [
    '本地 AI 运行环境 · PyTorch',
    '本機 AI 執行環境 · PyTorch',
    'Local AI runtime · PyTorch',
    'Lokale KI-Laufzeit · PyTorch'
  ],
  oneDriveFolder: [
    'OneDrive 本地目录',
    'OneDrive 本機目錄',
    'Local OneDrive folder',
    'Lokaler OneDrive-Ordner'
  ],
  tagManagement: ['标签管理', '標籤管理', 'Tag management', 'Tag-Verwaltung'],
  autoTagRules: [
    '自动打标规则',
    '自動標籤規則',
    'Automatic tagging rules',
    'Automatische Tag-Regeln'
  ],
  qwenModels: ['Qwen 本地模型', 'Qwen 本機模型', 'Local Qwen models', 'Lokale Qwen-Modelle'],
  comfyConnection: ['Comfy 连接', 'Comfy 連線', 'Comfy connection', 'Comfy-Verbindung'],
  imageUnderstanding: ['图片理解', '圖片理解', 'Image understanding', 'Bildanalyse'],
  aiImageCreation: ['AI 图片创作', 'AI 圖片創作', 'AI image creation', 'KI-Bilderstellung'],
  studioWorkflows: [
    'Studio 工作流预设',
    'Studio 工作流程預設',
    'Studio workflow presets',
    'Studio-Workflow-Vorlagen'
  ],
  longPressMenu: [
    '长按打开菜单',
    '長按開啟選單',
    'Long press for menu',
    'Menü durch langes Drücken'
  ],
  longPressMenuHint: [
    '适合触屏操作。长按卡片打开菜单；鼠标也可右键打开。',
    '適合觸控操作。長按卡片開啟選單；滑鼠也可按右鍵。',
    'On touch screens, hold a card to open its menu; right-click also works.',
    'Auf Touchscreens eine Karte gedrückt halten; Rechtsklick funktioniert ebenfalls.'
  ],
  confirmSingleDelete: [
    '删除单个文件前确认',
    '刪除單個檔案前確認',
    'Confirm single-file deletion',
    'Löschen einzelner Dateien bestätigen'
  ],
  confirmSingleDeleteHint: [
    '批量删除和删除文件夹始终需要确认。',
    '批次刪除與刪除資料夾一律需要確認。',
    'Bulk deletion and folder deletion always require confirmation.',
    'Mehrfach- und Ordnerlöschungen erfordern immer eine Bestätigung.'
  ],
  supportedFormats: [
    '支持的文件格式',
    '支援的檔案格式',
    'Supported formats',
    'Unterstützte Formate'
  ],
  supportedFormatsHint: [
    '这些扩展名可扫描进媒体库；能否播放取决于浏览器或桌面 WebView 的解码器。',
    '這些副檔名可掃描進媒體庫；能否播放取決於瀏覽器或桌面 WebView 的解碼器。',
    'These extensions can be scanned; playback depends on browser or desktop WebView decoders.',
    'Diese Dateitypen können erfasst werden; die Wiedergabe hängt von Browser- oder WebView-Codecs ab.'
  ],
  imagePlural: ['图片', '圖片', 'Images', 'Bilder'],
  videoPlural: ['视频', '影片', 'Videos', 'Videos'],
  audioPlural: ['音频', '音訊', 'Audio', 'Audio'],
  browsePreferencesNote: [
    '调整媒体库的缩略图大小和图片加载清晰度。',
    '調整媒體庫的縮圖大小和圖片載入清晰度。',
    'Adjust thumbnail size and image quality in the media library.',
    'Vorschaugröße und Bildqualität in der Mediathek anpassen.'
  ],
  cardWidth: [
    '小缩略图宽度',
    '小縮圖寬度',
    'Small thumbnail width',
    'Breite kleiner Vorschaubilder'
  ],
  cardWidthHint: [
    '默认使用小档；中为 1.4 倍，大为 1.9 倍。实际列宽随窗口自适应。',
    '預設使用小檔；中為 1.4 倍，大為 1.9 倍。實際欄寬隨視窗自適應。',
    'Small is the default; medium is 1.4× and large is 1.9×. Columns fit the window.',
    'Klein ist Standard; Mittel ist 1,4× und Groß 1,9×. Spalten passen sich dem Fenster an.'
  ],
  imageThumbnailPreview: [
    '图片使用缩略图',
    '圖片使用縮圖',
    'Use thumbnails for images',
    'Vorschaubilder für Bilder verwenden'
  ],
  thumbnailHint: [
    '开启可减少加载量；关闭后加载原图。视频和音频仍显示封面。',
    '開啟可減少載入量；關閉後載入原圖。影片和音訊仍顯示封面。',
    'On reduces image loading; off loads originals. Video and audio keep their covers.',
    'Aktiv lädt kleinere Bilder, deaktiviert Originale. Video und Audio behalten ihre Cover.'
  ],
  thumbnailShortEdge: [
    '图片缩略图清晰度',
    '圖片縮圖清晰度',
    'Image thumbnail quality',
    'Bildvorschauqualität'
  ],
  thumbnailShortEdgeHint: [
    '缩略图短边上限。越大越清晰、加载量越高，不改变卡片尺寸。',
    '縮圖短邊上限。越大越清晰、載入量越高，不改變卡片尺寸。',
    'Thumbnail short-edge limit. Higher values improve detail and load more data without changing card size.',
    'Grenze der kurzen Vorschaukante. Höhere Werte erhöhen Details und Datenmenge, nicht die Kartengröße.'
  ],
  mediaIndex: ['媒体索引', '媒體索引', 'Media index', 'Medienindex'],
  mediaIndexHint: [
    '管理文件变化检查与生成信息索引。',
    '管理檔案變更檢查與生成資訊索引。',
    'Manage file-change checks and generation metadata indexing.',
    'Dateiänderungen und Generierungsmetadaten verwalten.'
  ],
  autoCheckChanges: [
    '自动检查文件变化',
    '自動檢查檔案變更',
    'Check file changes automatically',
    'Dateiänderungen automatisch prüfen'
  ],
  autoCheckChangesHint: [
    '媒体库打开时每分钟检查一次；发现变化后增量扫描。',
    '媒體庫開啟時每分鐘檢查一次；發現變更後增量掃描。',
    'While the library is open, check each minute and scan changes incrementally.',
    'Bei geöffneter Mediathek minütlich prüfen und Änderungen scannen.'
  ],
  rebuildMediaIndex: [
    '重建媒体索引',
    '重建媒體索引',
    'Rebuild media index',
    'Medienindex neu aufbauen'
  ],
  rebuildMediaIndexHint: [
    '索引异常或需要重新解析全部生成信息时使用。',
    '索引異常或需要重新解析全部生成資訊時使用。',
    'Use when the index is damaged or all generation metadata needs reparsing.',
    'Bei Indexfehlern oder zur erneuten Analyse aller Generierungsdaten verwenden.'
  ],
  rebuildIndex: ['重建索引', '重建索引', 'Rebuild index', 'Index neu aufbauen'],
  rebuildIndexWarning: [
    '这会重新扫描媒体并解析生成信息。媒体较多时可能需要一些时间。',
    '這會重新掃描媒體並解析生成資訊。媒體較多時可能需要一些時間。',
    'This rescans media and parses generation metadata; large libraries may take time.',
    'Medien und Generierungsdaten werden erneut gescannt; große Mediatheken benötigen Zeit.'
  ],
  startRebuild: ['开始重建', '開始重建', 'Start rebuild', 'Neuaufbau starten']
} as const

export type UiKey = keyof typeof ui
const oldMessages: Record<AppLanguage, Record<string, string>> = { zhHans, zhHant, en, de }
const languageIndex: Record<AppLanguage, number> = { zhHans: 0, zhHant: 1, en: 2, de: 3 }
const storageKey = 'iib-react-language'
let sharedLanguage: AppLanguage | null = null

export function hydrateLanguage(global: Record<string, unknown>): void {
  sharedLanguage = languages.includes(global.lang as AppLanguage)
    ? (global.lang as AppLanguage)
    : null
}

function preferredLanguage(): AppLanguage {
  if (sharedLanguage) return sharedLanguage
  try {
    const saved = localStorage.getItem(storageKey)
    if (languages.includes(saved as AppLanguage)) return saved as AppLanguage
    const legacy = JSON.parse(
      localStorage.getItem('omnigallery:useApplicationStore') || 'null'
    ) as { lang?: string } | null
    if (legacy?.lang && languages.includes(legacy.lang as AppLanguage))
      return legacy.lang as AppLanguage
  } catch {
    /* Use the browser preference when storage cannot be read. */
  }
  const preferred = navigator.language.toLowerCase()
  if (preferred.startsWith('zh')) return /hk|tw|mo/.test(preferred) ? 'zhHant' : 'zhHans'
  return preferred.startsWith('de') ? 'de' : 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(preferredLanguage)
  async function changeLanguage(value: AppLanguage): Promise<void> {
    setLanguage(value)
    await patchServerPreferences({ lang: value })
  }
  useEffect(() => {
    document.documentElement.lang = { zhHans: 'zh-CN', zhHant: 'zh-TW', en: 'en', de: 'de' }[
      language
    ]
    try {
      localStorage.setItem(storageKey, language)
    } catch {
      /* storage is optional */
    }
  }, [language])
  const value = useMemo<LocaleContextValue>(
    () => ({
      language,
      setLanguage: changeLanguage,
      t: (key) =>
        key in ui
          ? ui[key as UiKey][languageIndex[language]]
          : oldMessages[language][key] || oldMessages.zhHans[key] || key
    }),
    [language]
  )
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLanguage() {
  const value = useContext(LocaleContext)
  if (!value) throw new Error('LanguageProvider is missing')
  return value
}
