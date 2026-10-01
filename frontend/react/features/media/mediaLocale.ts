import { useCallback } from 'react'
import { useLanguage } from '../../design/i18n'

// Media-specific copy follows the language selected by the shared React shell.
// Keys are the Simplified Chinese source copy, so unfinished keys remain readable.
const translations: Record<string, readonly [string, string, string]> = {
  全部媒体: ['全部媒體', 'All media', 'Alle Medien'],
  筛选: ['篩選', 'Filter', 'Filtern'],
  清除筛选: ['清除篩選', 'Clear filters', 'Filter zurücksetzen'],
  试听: ['試聽', 'Listen', 'Anhören'],
  '试听：{name}': ['試聽：{name}', 'Listen: {name}', 'Anhören: {name}'],
  '已显示 {count} 项': ['已顯示 {count} 項', '{count} items shown', '{count} Elemente angezeigt'],
  '{count} / {total} 项': [
    '{count} / {total} 項',
    '{count} / {total} items',
    '{count} / {total} Elemente'
  ],
  'AI 画面搜索': ['AI 畫面搜尋', 'AI visual search', 'KI-Bildsuche'],
  '开启 AI 画面搜索': ['開啟 AI 畫面搜尋', 'Enable AI visual search', 'KI-Bildsuche aktivieren'],
  '关闭 AI 画面搜索': ['關閉 AI 畫面搜尋', 'Disable AI visual search', 'KI-Bildsuche deaktivieren'],
  搜索画面: ['搜尋畫面', 'Search images', 'Bilder suchen'],
  图库视图与操作: ['圖庫檢視與操作', 'Gallery view and actions', 'Galerieansicht und Aktionen'],
  显示信息: ['顯示資訊', 'Show information', 'Informationen anzeigen'],
  常驻显示文件名和标签: [
    '持續顯示檔名與標籤',
    'Keep filenames and tags visible',
    'Dateinamen und Tags dauerhaft anzeigen'
  ],
  媒体库更多操作: ['媒體庫更多操作', 'More library actions', 'Weitere Bibliotheksaktionen'],
  搜索标签: ['搜尋標籤', 'Search tags', 'Tags suchen'],
  搜索标签或分组: ['搜尋標籤或分組', 'Search tags or groups', 'Tags oder Gruppen suchen'],
  清除标签搜索: ['清除標籤搜尋', 'Clear tag search', 'Tag-Suche löschen'],
  没有匹配的标签: ['沒有相符的標籤', 'No matching tags', 'Keine passenden Tags'],
  '还有 {count} 个，输入名称查找': [
    '還有 {count} 個，輸入名稱查找',
    '{count} more tags; type a name to find them',
    '{count} weitere Tags; Namen zum Suchen eingeben'
  ],
  '正在扫描…': ['正在掃描…', 'Scanning…', 'Wird gescannt…'],
  '已应用 {count} 项筛选': [
    '已套用 {count} 項篩選',
    '{count} filters applied',
    '{count} Filter angewendet'
  ],
  图片: ['圖片', 'Images', 'Bilder'],
  视频: ['影片', 'Videos', 'Videos'],
  音频: ['音訊', 'Audio', 'Audio'],
  目录: ['目錄', 'Folders', 'Ordner'],
  文件: ['檔案', 'File', 'Datei'],
  自定义顺序: ['自訂順序', 'Custom order', 'Eigene Reihenfolge'],
  最近更新: ['最近更新', 'Recently updated', 'Zuletzt aktualisiert'],
  最早更新: ['最早更新', 'Oldest updated', 'Älteste Aktualisierung'],
  '名称 A–Z': ['名稱 A–Z', 'Name A–Z', 'Name A–Z'],
  '名称 Z–A': ['名稱 Z–A', 'Name Z–A', 'Name Z–A'],
  文件大小: ['檔案大小', 'File size', 'Dateigröße'],
  未知大小: ['未知大小', 'Unknown size', 'Größe unbekannt'],
  '相关度 {score}': ['相關度 {score}', 'Relevance {score}', 'Relevanz {score}'],
  '预览：{name}': ['預覽：{name}', 'Preview: {name}', 'Vorschau: {name}'],
  '选择 {name}': ['選取 {name}', 'Select {name}', '{name} auswählen'],
  '{name} 的更多操作': [
    '{name} 的更多操作',
    'More actions for {name}',
    'Weitere Aktionen für {name}'
  ],
  查找相似图片: ['尋找相似圖片', 'Find similar images', 'Ähnliche Bilder finden'],
  编辑标签: ['編輯標籤', 'Edit tags', 'Tags bearbeiten'],
  复制路径: ['複製路徑', 'Copy path', 'Pfad kopieren'],
  在文件夹中显示: ['在資料夾中顯示', 'Show in folder', 'Im Ordner anzeigen'],
  用其他应用打开: ['使用其他應用程式開啟', 'Open with another app', 'Mit einer anderen App öffnen'],
  调整图片: ['調整圖片', 'Edit original image', 'Originalbild bearbeiten'],
  动态图片暂不支持调整: [
    '動態圖片暫不支援調整',
    'Animated images cannot be edited here yet',
    'Animierte Bilder können hier noch nicht bearbeitet werden'
  ],
  下载文件: ['下載檔案', 'Download file', 'Datei herunterladen'],
  重命名: ['重新命名', 'Rename', 'Umbenennen'],
  删除文件: ['刪除檔案', 'Delete file', 'Datei löschen'],
  '折叠 {name}': ['收合 {name}', 'Collapse {name}', '{name} einklappen'],
  '展开 {name}': ['展開 {name}', 'Expand {name}', '{name} aufklappen'],
  浏览: ['瀏覽', 'Browse', 'Durchsuchen'],
  '读取子目录…': ['讀取子目錄…', 'Loading subfolders…', 'Unterordner werden geladen…'],
  没有子目录: ['沒有子目錄', 'No subfolders', 'Keine Unterordner'],
  返回目录: ['返回目錄', 'Back to folders', 'Zurück zu den Ordnern'],
  从目录浏览和整理本机文件: [
    '從目錄瀏覽與整理本機檔案',
    'Browse and organize local files by folder',
    'Lokale Dateien nach Ordnern durchsuchen und ordnen'
  ],
  '浏览、查找和整理你的本地媒体': [
    '瀏覽、尋找與整理本機媒體',
    'Browse, find and organize your local media',
    'Lokale Medien durchsuchen, finden und ordnen'
  ],
  添加文件夹: ['新增資料夾', 'Add folder', 'Ordner hinzufügen'],
  这些文件夹已在媒体库中: [
    '這些資料夾已在媒體庫中',
    'These folders are already in the library',
    'Diese Ordner sind bereits in der Mediathek'
  ],
  '已跳过文件和无法读取的路径，只能添加文件夹': [
    '已略過檔案及無法讀取的路徑；只能新增資料夾',
    'Files and unreadable paths were skipped; only folders can be added',
    'Dateien und unlesbare Pfade wurden übersprungen; nur Ordner können hinzugefügt werden'
  ],
  '添加 {count} 个文件夹？': [
    '新增 {count} 個資料夾？',
    'Add {count} folders?',
    '{count} Ordner hinzufügen?'
  ],
  添加并扫描: ['新增並掃描', 'Add and scan', 'Hinzufügen und erfassen'],
  文件夹操作: ['資料夾操作', 'Folder actions', 'Ordneraktionen'],
  查看全部内容: ['查看全部內容', 'View all contents', 'Alle Inhalte anzeigen'],
  查看选项: ['檢視選項', 'View options', 'Ansichtsoptionen'],
  仅当前文件夹: ['僅目前資料夾', 'Current folder only', 'Nur aktueller Ordner'],
  '逐级读取子目录，包含尚未扫描的媒体文件。': [
    '逐級讀取子資料夾，包含尚未掃描的媒體檔案。',
    'Reading subfolders one by one, including media not yet scanned.',
    'Unterordner werden nacheinander gelesen, auch noch nicht erfasste Medien.'
  ],
  '已读取 {count} 项，待读取 {pending} 个目录': [
    '已讀取 {count} 項，待讀取 {pending} 個目錄',
    '{count} items read · {pending} folders pending',
    '{count} Elemente gelesen · {pending} Ordner ausstehend'
  ],
  读取下一个目录: ['讀取下一個目錄', 'Load next folder', 'Nächsten Ordner laden'],
  搜索当前文件夹及子目录的文件名: [
    '搜尋目前資料夾及子資料夾的檔名',
    'Search filenames in this folder and its subfolders',
    'Dateinamen in diesem Ordner und Unterordnern suchen'
  ],
  '递归浏览只匹配文件名；高级搜索请返回当前文件夹。': [
    '遞迴瀏覽只比對檔名；進階搜尋請返回目前資料夾。',
    'Recursive browsing matches filenames only. Return to the current folder for advanced search.',
    'Die rekursive Ansicht sucht nur nach Dateinamen. Für die erweiterte Suche zum aktuellen Ordner zurückkehren.'
  ],
  高级筛选请返回当前文件夹: [
    '進階篩選請返回目前資料夾',
    'Return to the current folder for advanced filters',
    'Für erweiterte Filter zum aktuellen Ordner zurückkehren'
  ],
  正在逐级读取目录: ['正在逐級讀取目錄', 'Reading subfolders', 'Unterordner werden gelesen'],
  '继续读取下一个目录以查找文件。': [
    '繼續讀取下一個目錄以尋找檔案。',
    'Load the next folder to find files.',
    'Den nächsten Ordner laden, um Dateien zu finden.'
  ],
  分享目录链接: ['分享目錄連結', 'Share folder link', 'Ordnerlink teilen'],
  目录链接已复制: ['目錄連結已複製', 'Folder link copied', 'Ordnerlink kopiert'],
  '轮询间隔（秒）': [
    '輪詢間隔（秒）',
    'Refresh interval (seconds)',
    'Aktualisierungsintervall (Sekunden)'
  ],
  开始轮询刷新: ['開始輪詢重新整理', 'Start polling refresh', 'Regelmäßige Aktualisierung starten'],
  停止轮询刷新: ['停止輪詢重新整理', 'Stop polling refresh', 'Regelmäßige Aktualisierung stoppen'],
  正在轮询刷新: [
    '正在輪詢重新整理',
    'Polling refresh is active',
    'Regelmäßige Aktualisierung ist aktiv'
  ],
  轮询刷新未开启: [
    '輪詢重新整理未開啟',
    'Polling refresh is off',
    'Regelmäßige Aktualisierung ist aus'
  ],
  '递归浏览期间不启用轮询刷新。': [
    '遞迴瀏覽期間不啟用輪詢重新整理。',
    'Polling refresh is unavailable during recursive browsing.',
    'Während der rekursiven Ansicht ist die regelmäßige Aktualisierung nicht verfügbar.'
  ],
  '停留在当前目录时，按设定间隔静默刷新文件列表；打开预览时暂停。': [
    '停留在目前目錄時，按設定間隔靜默重新整理檔案清單；開啟預覽時暫停。',
    'Quietly refreshes the current folder at this interval; pauses while a preview is open.',
    'Aktualisiert den aktuellen Ordner im festgelegten Intervall ohne Hinweis; pausiert bei geöffneter Vorschau.'
  ],
  压平文件夹: ['壓平資料夾', 'Flatten folder', 'Ordner abflachen'],
  没有需要移动的文件: [
    '沒有需要移動的檔案',
    'No files need to be moved',
    'Keine Dateien müssen verschoben werden'
  ],
  压平文件夹未完成: [
    '壓平資料夾未完成',
    'Could not finish flattening the folder',
    'Der Ordner konnte nicht vollständig abgeflacht werden'
  ],
  '压平完成，已移动 {count} 个文件': [
    '壓平完成，已移動 {count} 個檔案',
    'Flattened the folder and moved {count} files',
    'Ordner abgeflacht und {count} Dateien verschoben'
  ],
  '发现文件名冲突，无法压平文件夹': [
    '發現檔名衝突，無法壓平資料夾',
    'Filename conflicts prevent flattening',
    'Dateinamenskonflikte verhindern das Abflachen'
  ],
  '下列文件名重复，移动前需要先改名：': [
    '下列檔名重複，移動前請先重新命名：',
    'These filenames are repeated. Rename them before moving:',
    'Diese Dateinamen kommen mehrfach vor. Benennen Sie sie vor dem Verschieben um:'
  ],
  '子文件夹里的媒体文件将移动到当前文件夹；变空的子文件夹会被删除。非媒体文件保留原位。': [
    '子資料夾中的媒體檔案會移至目前資料夾；變空的子資料夾會被刪除。非媒體檔案保留原位。',
    'Media files in subfolders will move into this folder. Empty subfolders will be removed; other files stay where they are.',
    'Mediendateien aus Unterordnern werden in diesen Ordner verschoben. Leere Unterordner werden entfernt; andere Dateien bleiben am Ort.'
  ],
  '确认移动 {count} 个文件？': [
    '確認移動 {count} 個檔案？',
    'Move {count} files?',
    '{count} Dateien verschieben?'
  ],
  确认移动: ['確認移動', 'Move files', 'Dateien verschieben'],
  关闭: ['關閉', 'Close', 'Schließen'],
  '也可以将资源管理器中的文件夹拖入此页添加到媒体库。': [
    '也可以將檔案總管中的資料夾拖入此頁新增至媒體庫。',
    'You can also drag folders from File Explorer onto this page to add them.',
    'Sie können Ordner aus dem Datei-Explorer auf diese Seite ziehen, um sie hinzuzufügen.'
  ],
  '已添加并扫描 {count} 个文件夹': [
    '已新增並掃描 {count} 個資料夾',
    'Added and scanned {count} folders',
    '{count} Ordner hinzugefügt und erfasst'
  ],
  '文件夹已添加，但扫描未完成，请稍后重试': [
    '資料夾已新增，但掃描未完成；請稍後重試',
    'Folders were added, but scanning did not finish. Please try again later.',
    'Ordner wurden hinzugefügt, aber die Erfassung wurde nicht abgeschlossen. Bitte später erneut versuchen.'
  ],
  扫描新增: ['掃描新增內容', 'Scan for new files', 'Neue Dateien erfassen'],
  查找已添加的文件夹: ['尋找已新增的資料夾', 'Find added folders', 'Hinzugefügte Ordner suchen'],
  查找目录: ['尋找目錄', 'Find folders', 'Ordner suchen'],
  '已添加 {count} 个文件夹': [
    '已新增 {count} 個資料夾',
    '{count} folders added',
    '{count} Ordner hinzugefügt'
  ],
  刷新目录: ['重新整理目錄', 'Refresh folders', 'Ordner aktualisieren'],
  修改显示名称: ['修改顯示名稱', 'Change display name', 'Anzeigenamen ändern'],
  移除入口: ['移除入口', 'Remove shortcut', 'Verknüpfung entfernen'],
  折叠目录: ['收合目錄', 'Collapse folders', 'Ordner einklappen'],
  展开目录: ['展開目錄', 'Expand folders', 'Ordner aufklappen'],
  浏览文件: ['瀏覽檔案', 'Browse files', 'Dateien durchsuchen'],
  添加你的第一个文件夹: ['新增第一個資料夾', 'Add your first folder', 'Ersten Ordner hinzufügen'],
  '文件保持原位，添加后即可扫描、浏览和整理。': [
    '檔案維持原位；新增後即可掃描、瀏覽和整理。',
    'Files stay where they are. Add a folder to scan, browse and organize them.',
    'Dateien bleiben am Ort. Fügen Sie einen Ordner zum Erfassen und Durchsuchen hinzu.'
  ],
  文件夹位置: ['資料夾位置', 'Folder location', 'Ordnerposition'],
  新建子文件夹: ['新增子資料夾', 'New subfolder', 'Neuer Unterordner'],
  子文件夹: ['子資料夾', 'Subfolders', 'Unterordner'],
  搜索方式: ['搜尋方式', 'Search mode', 'Suchmodus'],
  关键词: ['關鍵字', 'Keywords', 'Schlüsselwörter'],
  描述画面: ['描述畫面', 'Describe image', 'Bild beschreiben'],
  搜索媒体: ['搜尋媒體', 'Search media', 'Medien suchen'],
  描述想找的画面: [
    '描述想找的畫面',
    'Describe the image you want to find',
    'Gesuchtes Bild beschreiben'
  ],
  搜索当前文件夹中的媒体: [
    '搜尋目前資料夾中的媒體',
    'Search media in this folder',
    'Medien in diesem Ordner suchen'
  ],
  '搜索文件名、标签或描述': [
    '搜尋檔名、標籤或描述',
    'Search names, tags or descriptions',
    'Namen, Tags oder Beschreibungen suchen'
  ],
  清除搜索文字: ['清除搜尋文字', 'Clear search text', 'Suchtext löschen'],
  搜索: ['搜尋', 'Search', 'Suchen'],
  选择参考图片: ['選取參考圖片', 'Choose reference image', 'Referenzbild auswählen'],
  '以图搜图，也可在搜索框粘贴或拖入图片': [
    '以圖搜圖；也可在搜尋框貼上或拖入圖片',
    'Search by image; you can also paste or drop an image in the search box',
    'Mit Bild suchen; Bild auch in das Suchfeld einfügen oder ziehen'
  ],
  以图搜图: ['以圖搜圖', 'Search by image', 'Mit Bild suchen'],
  筛选媒体: ['篩選媒體', 'Filter media', 'Medien filtern'],
  刷新结果: ['重新整理結果', 'Refresh results', 'Ergebnisse aktualisieren'],
  '画面索引 {indexed} / {total}': [
    '畫面索引 {indexed} / {total}',
    'Visual index {indexed} / {total}',
    'Bildindex {indexed} / {total}'
  ],
  '画面搜索尚未就绪，请在设置中配置模型': [
    '畫面搜尋尚未就緒，請在設定中配置模型',
    'Visual search is not ready. Configure a model in Settings.',
    'Bildsuche ist nicht bereit. Modell in den Einstellungen konfigurieren.'
  ],
  '正在检查画面搜索状态…': [
    '正在檢查畫面搜尋狀態…',
    'Checking visual search…',
    'Bildsuche wird geprüft…'
  ],
  更新索引: ['更新索引', 'Update index', 'Index aktualisieren'],
  建立索引: ['建立索引', 'Build index', 'Index erstellen'],
  搜图参考图片: ['搜圖參考圖片', 'Search reference image', 'Referenzbild für die Suche'],
  'AI 相似': ['AI 相似', 'AI similar', 'KI-Ähnlichkeit'],
  找重复: ['找重複', 'Find duplicates', 'Duplikate finden'],
  '最低相关度 {value}': [
    '最低相關度 {value}',
    'Minimum relevance {value}',
    'Mindest-Relevanz {value}'
  ],
  更换图片: ['更換圖片', 'Change image', 'Bild wechseln'],
  退出搜图: ['退出搜圖', 'Exit image search', 'Bildsuche beenden'],
  '正在查找…': ['正在尋找…', 'Searching…', 'Suche läuft…'],
  '找到 {count} 项': ['找到 {count} 項', '{count} found', '{count} gefunden'],
  '正在匹配画面…': ['正在比對畫面…', 'Matching images…', 'Bilder werden abgeglichen…'],
  '画面搜索 · {count} 项': [
    '畫面搜尋 · {count} 項',
    'Visual search · {count} items',
    'Bildsuche · {count} Elemente'
  ],
  当前目录: ['目前目錄', 'Current folder', 'Aktueller Ordner'],
  '{name} · 已显示 {count} 项': [
    '{name} · 已顯示 {count} 項',
    '{name} · {count} shown',
    '{name} · {count} angezeigt'
  ],
  '{count} 项': ['{count} 項', '{count} items', '{count} Elemente'],
  仅排序已加载的项目: [
    '僅排序已載入的項目',
    'Sorting applies to loaded items only',
    'Sortierung gilt nur für geladene Elemente'
  ],
  排序方式: ['排序方式', 'Sort order', 'Sortierung'],
  缩略图大小: ['縮圖大小', 'Thumbnail size', 'Vorschaubildgröße'],
  小: ['小', 'Small', 'Klein'],
  中: ['中', 'Medium', 'Mittel'],
  大: ['大', 'Large', 'Groß'],
  取消全选: ['取消全選', 'Deselect all', 'Auswahl aufheben'],
  全选已加载: ['全選已載入項目', 'Select all loaded', 'Alle geladenen auswählen'],
  已选择文件的操作: ['已選檔案的操作', 'Selected file actions', 'Aktionen für ausgewählte Dateien'],
  '已选 {count}': ['已選 {count}', '{count} selected', '{count} ausgewählt'],
  清除选择: ['清除選取', 'Clear selection', 'Auswahl löschen'],
  反选: ['反選', 'Invert selection', 'Auswahl umkehren'],
  标签: ['標籤', 'Tags', 'Tags'],
  '复制到…': ['複製到…', 'Copy to…', 'Kopieren nach…'],
  '移动到…': ['移動到…', 'Move to…', 'Verschieben nach…'],
  下载: ['下載', 'Download', 'Herunterladen'],
  删除: ['刪除', 'Delete', 'Löschen'],
  没有找到相似图片: [
    '找不到相似圖片',
    'No similar images found',
    'Keine ähnlichen Bilder gefunden'
  ],
  没有找到相关画面: [
    '找不到相關畫面',
    'No matching images found',
    'Keine passenden Bilder gefunden'
  ],
  没有找到匹配的媒体: [
    '找不到符合的媒體',
    'No matching media found',
    'Keine passenden Medien gefunden'
  ],
  这里还没有媒体文件: [
    '這裡尚無媒體檔案',
    'No media files here yet',
    'Hier sind noch keine Medien'
  ],
  '试着降低最低相关度，或换一张参考图片。': [
    '試著降低最低相關度，或更換參考圖片。',
    'Lower the minimum relevance or try another reference image.',
    'Senken Sie die Mindest-Relevanz oder wählen Sie ein anderes Referenzbild.'
  ],
  '试试换一种描述，或更新画面索引。': [
    '試試其他描述，或更新畫面索引。',
    'Try another description or update the visual index.',
    'Versuchen Sie eine andere Beschreibung oder aktualisieren Sie den Bildindex.'
  ],
  '试试其他关键词或调整筛选条件。': [
    '試試其他關鍵字或調整篩選條件。',
    'Try different keywords or adjust the filters.',
    'Versuchen Sie andere Suchwörter oder Filter.'
  ],
  '添加媒体文件夹并扫描后，就能在这里浏览。': [
    '新增媒體資料夾並掃描後，即可在此瀏覽。',
    'Add a media folder and scan it to browse here.',
    'Fügen Sie einen Medienordner hinzu und erfassen Sie ihn.'
  ],
  清除搜索: ['清除搜尋', 'Clear search', 'Suche löschen'],
  刷新: ['重新整理', 'Refresh', 'Aktualisieren'],
  加载更多: ['載入更多', 'Load more', 'Mehr laden'],
  包含子文件夹: ['包含子資料夾', 'Include subfolders', 'Unterordner einschließen'],
  '可按标签与尺寸组合筛选。多个“必须包含”标签需要同时满足。': [
    '可依標籤與尺寸組合篩選；多個「必須包含」標籤須同時符合。',
    'Combine tags and dimensions. All required tags must match.',
    'Tags und Maße kombinieren. Alle erforderlichen Tags müssen übereinstimmen.'
  ],
  必须包含的标签: ['必須包含的標籤', 'Required tags', 'Erforderliche Tags'],
  包含任一标签: ['包含任一標籤', 'Any of these tags', 'Eines dieser Tags'],
  排除标签: ['排除標籤', 'Exclude tags', 'Tags ausschließen'],
  没有自定义标签: ['沒有自訂標籤', 'No custom tags', 'Keine eigenen Tags'],
  尺寸: ['尺寸', 'Dimensions', 'Abmessungen'],
  '宽度 px': ['寬度 px', 'Width px', 'Breite px'],
  '高度 px': ['高度 px', 'Height px', 'Höhe px'],
  比例宽: ['比例寬', 'Ratio width', 'Verhältnisbreite'],
  比例高: ['比例高', 'Ratio height', 'Verhältnishöhe'],
  清空: ['清空', 'Clear', 'Leeren'],
  应用筛选: ['套用篩選', 'Apply filters', 'Filter anwenden'],
  预览: ['預覽', 'Preview', 'Vorschau'],
  预览操作: ['預覽操作', 'Preview controls', 'Vorschau-Steuerung'],
  视图操作: ['檢視操作', 'View controls', 'Ansicht-Steuerung'],
  关闭预览: ['關閉預覽', 'Close preview', 'Vorschau schließen'],
  更多操作: ['更多操作', 'More actions', 'Weitere Aktionen'],
  缩放比例: ['縮放比例', 'Zoom level', 'Zoomstufe'],
  全屏: ['全螢幕', 'Fullscreen', 'Vollbild'],
  退出全屏: ['退出全螢幕', 'Exit fullscreen', 'Vollbild verlassen'],
  放大: ['放大', 'Zoom in', 'Vergrößern'],
  缩小: ['縮小', 'Zoom out', 'Verkleinern'],
  旋转图片: ['旋轉圖片', 'Rotate image', 'Bild drehen'],
  重置视图: ['重設檢視', 'Reset view', 'Ansicht zurücksetzen'],
  显示媒体描述: ['顯示媒體描述', 'Show media description', 'Medienbeschreibung anzeigen'],
  隐藏媒体描述: ['隱藏媒體描述', 'Hide media description', 'Medienbeschreibung ausblenden'],
  展开详细信息: ['展開詳細資訊', 'Show details', 'Details anzeigen'],
  收起详细信息: ['收起詳細資訊', 'Hide details', 'Details ausblenden'],
  暂无描述: ['暫無描述', 'No description yet', 'Noch keine Beschreibung'],
  音频封面: ['音訊封面', 'Audio cover', 'Audiocover'],
  歌词或台词: ['歌詞或台詞', 'Lyrics or dialogue', 'Liedtext oder Dialog'],
  此文件没有可显示的歌词或台词: [
    '此檔案沒有可顯示的歌詞或台詞',
    'This file has no lyrics or dialogue to display.',
    'Diese Datei enthält keinen anzeigbaren Liedtext oder Dialog.'
  ],
  无法预览此文件: [
    '無法預覽此檔案',
    'Could not preview this file',
    'Datei kann nicht angezeigt werden'
  ],
  '可下载原文件后用本机应用打开。': [
    '可下載原始檔後使用本機應用程式開啟。',
    'Download the original file and open it in a local app.',
    'Laden Sie die Originaldatei herunter und öffnen Sie sie in einer lokalen App.'
  ],
  上一项: ['上一項', 'Previous item', 'Vorheriges Element'],
  下一项: ['下一項', 'Next item', 'Nächstes Element'],
  '此文件仅在线，下载到本机后可预览。': [
    '此檔案僅在線上，下載到本機後可預覽。',
    'This file is online only. Download it to preview.',
    'Diese Datei ist nur online. Zum Anzeigen herunterladen.'
  ],
  新建制作: ['新增製作', 'Create draft', 'Neuen Entwurf erstellen'],
  添加媒体文件夹: ['新增媒體資料夾', 'Add media folder', 'Medienordner hinzufügen'],
  '文件保留在原位置，不会复制或上传。': [
    '檔案保留原位，不會複製或上傳。',
    'Files remain in place; nothing is copied or uploaded.',
    'Dateien bleiben am Ort; nichts wird kopiert oder hochgeladen.'
  ],
  '在 {path} 中创建真实文件夹。': [
    '在 {path} 中建立實際資料夾。',
    'Create a real folder inside {path}.',
    'Einen echten Ordner in {path} erstellen.'
  ],
  文件夹绝对路径: ['資料夾絕對路徑', 'Absolute folder path', 'Absoluter Ordnerpfad'],
  子文件夹名称: ['子資料夾名稱', 'Subfolder name', 'Name des Unterordners'],
  '浏览…': ['瀏覽…', 'Browse…', 'Durchsuchen…'],
  取消: ['取消', 'Cancel', 'Abbrechen'],
  添加: ['新增', 'Add', 'Hinzufügen'],
  重命名文件: ['重新命名檔案', 'Rename file', 'Datei umbenennen'],
  文件名: ['檔名', 'File name', 'Dateiname'],
  保存: ['儲存', 'Save', 'Speichern'],
  '下载文件？': ['下載檔案？', 'Download files?', 'Dateien herunterladen?'],
  '将下载 {count} 个文件。': [
    '將下載 {count} 個檔案。',
    'Download {count} files.',
    '{count} Dateien herunterladen.'
  ],
  确认删除文件: ['確認刪除檔案', 'Confirm file deletion', 'Dateilöschung bestätigen'],
  '将从本机磁盘删除 {count} 个文件。此操作无法在应用内撤销。': [
    '將從本機磁碟刪除 {count} 個檔案。無法在應用程式內復原。',
    'Delete {count} files from the local disk. This cannot be undone in the app.',
    '{count} Dateien von der lokalen Festplatte löschen. Dies kann in der App nicht rückgängig gemacht werden.'
  ],
  自定义标签: ['自訂標籤', 'Custom tags', 'Eigene Tags'],
  '正在读取标签…': ['正在讀取標籤…', 'Loading tags…', 'Tags werden geladen…'],
  选择标签: ['選取標籤', 'Select tags', 'Tags auswählen'],
  保存标签: ['儲存標籤', 'Save tags', 'Tags speichern'],
  批量编辑标签: ['批次編輯標籤', 'Edit tags in bulk', 'Tags gesammelt bearbeiten'],
  '将对已选的 {count} 个文件执行此操作。': [
    '將對已選的 {count} 個檔案執行此操作。',
    'Apply this action to {count} selected files.',
    'Diese Aktion auf {count} ausgewählte Dateien anwenden.'
  ],
  批量标签操作: ['批次標籤操作', 'Bulk tag action', 'Sammelaktion für Tags'],
  添加标签: ['新增標籤', 'Add tag', 'Tag hinzufügen'],
  移除标签: ['移除標籤', 'Remove tag', 'Tag entfernen'],
  搜索现有标签: ['搜尋現有標籤', 'Search existing tags', 'Vorhandene Tags suchen'],
  添加到已选: ['新增至已選項目', 'Add to selected', 'Zu Auswahl hinzufügen'],
  从已选移除: ['從已選項目移除', 'Remove from selected', 'Aus Auswahl entfernen'],
  移动文件: ['移動檔案', 'Move files', 'Dateien verschieben'],
  复制文件: ['複製檔案', 'Copy files', 'Dateien kopieren'],
  '已选择 {count} 个文件。目标必须是现有文件夹。': [
    '已選取 {count} 個檔案，目標必須是現有資料夾。',
    '{count} files selected. Choose an existing destination folder.',
    '{count} Dateien ausgewählt. Wählen Sie einen vorhandenen Zielordner.'
  ],
  已添加的目录: ['已新增的目錄', 'Added folders', 'Hinzugefügte Ordner'],
  '选择目录，或在下方填写子目录路径': [
    '選取目錄，或在下方填入子目錄路徑',
    'Choose a folder or enter a subfolder path below',
    'Ordner wählen oder unten Unterordnerpfad eingeben'
  ],
  目标文件夹路径: ['目標資料夾路徑', 'Destination folder path', 'Zielordnerpfad'],
  移动: ['移動', 'Move', 'Verschieben'],
  复制: ['複製', 'Copy', 'Kopieren'],
  显示名称: ['顯示名稱', 'Display name', 'Anzeigename'],
  移除目录入口: ['移除目錄入口', 'Remove folder shortcut', 'Ordnerverknüpfung entfernen'],
  '只移除“{name}”的浏览入口，不会删除磁盘文件。': [
    '僅移除「{name}」的瀏覽入口，不會刪除磁碟檔案。',
    'Remove the shortcut to “{name}” without deleting files from disk.',
    'Die Verknüpfung zu „{name}“ entfernen; Dateien bleiben erhalten.'
  ],
  无法连接媒体服务: [
    '無法連線至媒體服務',
    'Cannot connect to the media service',
    'Verbindung zum Mediendienst fehlgeschlagen'
  ],
  '操作失败，请重试': [
    '操作失敗，請重試',
    'Action failed. Please try again.',
    'Aktion fehlgeschlagen. Bitte erneut versuchen.'
  ],
  '媒体索引已更新，刷新列表可查看新增内容': [
    '媒體索引已更新；重新整理清單即可查看新增內容',
    'Media index updated. Refresh the list to see new files.',
    'Medienindex aktualisiert. Liste aktualisieren, um neue Dateien zu sehen.'
  ],
  无法读取子文件夹: [
    '無法讀取子資料夾',
    'Could not load subfolders',
    'Unterordner konnten nicht geladen werden'
  ],
  媒体加载失败: ['媒體載入失敗', 'Could not load media', 'Medien konnten nicht geladen werden'],
  '搜图失败，请检查参考图片或模型配置': [
    '搜圖失敗，請檢查參考圖片或模型設定',
    'Image search failed. Check the reference image or model settings.',
    'Bildsuche fehlgeschlagen. Referenzbild oder Modelleinstellungen prüfen.'
  ],
  '画面搜索失败，请检查模型配置': [
    '畫面搜尋失敗，請檢查模型設定',
    'Visual search failed. Check the model settings.',
    'Bildsuche fehlgeschlagen. Modelleinstellungen prüfen.'
  ],
  请选择图片作为搜图参考: [
    '請選取圖片作為搜圖參考',
    'Choose an image as the search reference',
    'Bitte ein Bild als Suchreferenz wählen'
  ],
  '参考图片请勿超过 50 MB': [
    '參考圖片不得超過 50 MB',
    'Reference images must be under 50 MB',
    'Referenzbilder dürfen höchstens 50 MB groß sein'
  ],
  无法读取所选图片: [
    '無法讀取所選圖片',
    'Could not read the selected image',
    'Ausgewähltes Bild konnte nicht gelesen werden'
  ],
  画面索引已开始更新: [
    '畫面索引已開始更新',
    'Visual index update started',
    'Aktualisierung des Bildindex gestartet'
  ],
  媒体索引已更新: ['媒體索引已更新', 'Media index updated', 'Medienindex aktualisiert'],
  扫描失败: ['掃描失敗', 'Scan failed', 'Erfassung fehlgeschlagen'],
  读取子目录失败: [
    '讀取子目錄失敗',
    'Could not load subfolders',
    'Unterordner konnten nicht geladen werden'
  ],
  请输入文件夹路径或名称: [
    '請輸入資料夾路徑或名稱',
    'Enter a folder path or name',
    'Ordnerpfad oder Namen eingeben'
  ],
  子文件夹名称不能包含路径分隔符: [
    '子資料夾名稱不得包含路徑分隔符',
    'A subfolder name cannot contain path separators',
    'Unterordnernamen dürfen keine Pfadtrennzeichen enthalten'
  ],
  文件夹已添加: ['資料夾已新增', 'Folder added', 'Ordner hinzugefügt'],
  文件已重命名: ['檔案已重新命名', 'File renamed', 'Datei umbenannt'],
  标签已更新: ['標籤已更新', 'Tags updated', 'Tags aktualisiert'],
  '已添加标签「{name}」': [
    '已新增標籤「{name}」',
    'Tag “{name}” added',
    'Tag „{name}“ hinzugefügt'
  ],
  '已为 {count} 项添加标签': [
    '已為 {count} 項新增標籤',
    'Added a tag to {count} items',
    'Tag zu {count} Elementen hinzugefügt'
  ],
  '已为 {count} 项移除标签': [
    '已為 {count} 項移除標籤',
    'Removed a tag from {count} items',
    'Tag von {count} Elementen entfernt'
  ],
  请选择目标文件夹: ['請選擇目標資料夾', 'Choose a destination folder', 'Zielordner auswählen'],
  目标文件夹不存在或无法访问: [
    '目標資料夾不存在或無法存取',
    'Destination folder does not exist or is inaccessible',
    'Zielordner fehlt oder ist nicht zugänglich'
  ],
  文件已移动: ['檔案已移動', 'Files moved', 'Dateien verschoben'],
  文件已复制: ['檔案已複製', 'Files copied', 'Dateien kopiert'],
  文件已删除: ['檔案已刪除', 'Files deleted', 'Dateien gelöscht'],
  '歌曲信息已写入 MP3 文件': [
    '歌曲資訊已寫入 MP3 檔案',
    'Song information saved to the MP3 file',
    'Titelinformationen in der MP3-Datei gespeichert'
  ],
  文件路径已复制: ['檔案路徑已複製', 'File path copied', 'Dateipfad kopiert'],
  宽高及比例必须成对填写有效正整数: [
    '寬高與比例必須成對輸入有效正整數',
    'Enter valid positive integers for both width and height or both ratio values',
    'Breite und Höhe sowie Seitenverhältnis paarweise als positive Ganzzahlen eingeben'
  ],
  移除: ['移除', 'Remove', 'Entfernen'],
  '读取失败，请重试': [
    '讀取失敗，請重試',
    'Could not load. Please try again.',
    'Laden fehlgeschlagen. Bitte erneut versuchen.'
  ],
  未知: ['未知', 'Unknown', 'Unbekannt'],
  未填写: ['未填寫', 'Not set', 'Nicht angegeben'],
  '此文件仅在线，下载到本机后可查看详情': [
    '此檔案僅在線上；下載到本機後可查看詳細資訊',
    'This file is online only. Download it to view details.',
    'Diese Datei ist nur online. Zum Anzeigen von Details herunterladen.'
  ],
  '媒体描述暂不可用：{error}': [
    '媒體描述暫時無法使用：{error}',
    'Media description unavailable: {error}',
    'Medienbeschreibung nicht verfügbar: {error}'
  ],
  '音频标签读取失败：{error}': [
    '音訊標籤讀取失敗：{error}',
    'Could not read audio tags: {error}',
    'Audio-Tags konnten nicht gelesen werden: {error}'
  ],
  编辑媒体描述: ['編輯媒體描述', 'Edit media description', 'Medienbeschreibung bearbeiten'],
  编辑原始生成信息: [
    '編輯原始生成資訊',
    'Edit raw generation info',
    'Generierungsrohdaten bearbeiten'
  ],
  '编辑 AI 参考提示词': [
    '編輯 AI 參考提示詞',
    'Edit AI reference prompt',
    'KI-Referenzprompt bearbeiten'
  ],
  '请选择 JPEG、PNG 或 WebP 图片': [
    '請選擇 JPEG、PNG 或 WebP 圖片',
    'Choose a JPEG, PNG or WebP image',
    'JPEG-, PNG- oder WebP-Bild auswählen'
  ],
  '封面不能超过 8 MB': [
    '封面不得超過 8 MB',
    'Cover art must be under 8 MB',
    'Coverbild darf höchstens 8 MB groß sein'
  ],
  '封面读取失败，请重新选择': [
    '封面讀取失敗，請重新選擇',
    'Could not read the cover. Choose it again.',
    'Cover konnte nicht gelesen werden. Bitte erneut auswählen.'
  ],
  描述: ['描述', 'Description', 'Beschreibung'],
  生成信息: ['生成資訊', 'Generation info', 'Generierungsdaten'],
  元信息: ['中繼資料', 'Metadata', 'Metadaten'],
  媒体详情: ['媒體詳細資訊', 'Media details', 'Mediendetails'],
  部分信息不可用: [
    '部分資訊無法使用',
    'Some details are unavailable',
    'Einige Details sind nicht verfügbar'
  ],
  重试: ['重試', 'Retry', 'Erneut versuchen'],
  媒体描述: ['媒體描述', 'Media description', 'Medienbeschreibung'],
  'AI 建议': ['AI 建議', 'AI suggestion', 'KI-Vorschlag'],
  编辑: ['編輯', 'Edit', 'Bearbeiten'],
  未填写媒体描述: ['未填寫媒體描述', 'No media description', 'Keine Medienbeschreibung'],
  'AI 参考提示词': ['AI 參考提示詞', 'AI reference prompt', 'KI-Referenzprompt'],
  'AI 反推': ['AI 反推', 'AI infer', 'KI-Ableitung'],
  未填写参考提示词: ['未填寫參考提示詞', 'No reference prompt', 'Kein Referenzprompt'],
  编辑原文: ['編輯原文', 'Edit raw text', 'Rohtext bearbeiten'],
  '这份信息包含结构化数据或特殊格式，请使用原文编辑以保留内容。': [
    '此資訊包含結構化資料或特殊格式；請以原文編輯以保留內容。',
    'This data has a structured or special format. Edit the raw text to preserve it.',
    'Diese Daten haben ein spezielles Format. Bearbeiten Sie den Rohtext, um Inhalte zu erhalten.'
  ],
  正向提示词: ['正向提示詞', 'Positive prompt', 'Positiver Prompt'],
  负向提示词: ['負向提示詞', 'Negative prompt', 'Negativer Prompt'],
  使用资源: ['使用資源', 'Resources used', 'Verwendete Ressourcen'],
  生成参数: ['生成參數', 'Generation parameters', 'Generierungsparameter'],
  '编辑{name}': ['編輯{name}', 'Edit {name}', '{name} bearbeiten'],
  添加参数: ['新增參數', 'Add parameter', 'Parameter hinzufügen'],
  '其他：{value}': ['其他：{value}', 'Other: {value}', 'Weitere: {value}'],
  暂无参数: ['暫無參數', 'No parameters', 'Keine Parameter'],
  查看原始信息: ['查看原始資訊', 'View raw information', 'Rohdaten anzeigen'],
  暂无生成信息: ['暫無生成資訊', 'No generation information', 'Keine Generierungsdaten'],
  文件信息: ['檔案資訊', 'File information', 'Dateiinformationen'],
  路径: ['路徑', 'Path', 'Pfad'],
  大小: ['大小', 'Size', 'Größe'],
  修改时间: ['修改時間', 'Modified', 'Geändert'],
  歌曲信息: ['歌曲資訊', 'Song information', 'Titelinformationen'],
  编辑歌曲信息: ['編輯歌曲資訊', 'Edit song information', 'Titelinformationen bearbeiten'],
  歌曲封面: ['歌曲封面', 'Song cover', 'Coverbild'],
  歌曲名: ['歌曲名稱', 'Song title', 'Titel'],
  标题来源: ['標題來源', 'Title source', 'Titelquelle'],
  内嵌标签: ['內嵌標籤', 'Embedded tag', 'Eingebetteter Tag'],
  艺术家: ['藝人', 'Artist', 'Künstler'],
  专辑: ['專輯', 'Album', 'Album'],
  时长: ['時長', 'Duration', 'Dauer'],
  封面来源: ['封面來源', 'Cover source', 'Coverquelle'],
  内嵌封面: ['內嵌封面', 'Embedded cover', 'Eingebettetes Cover'],
  同名图片: ['同名圖片', 'Same-name image', 'Gleichnamiges Bild'],
  目录封面: ['目錄封面', 'Folder cover', 'Ordner-Cover'],
  无封面: ['無封面', 'No cover', 'Kein Cover'],
  歌词: ['歌詞', 'Lyrics', 'Liedtext'],
  内嵌: ['內嵌', 'Embedded', 'Eingebettet'],
  同名文件: ['同名檔案', 'Same-name file', 'Gleichnamige Datei'],
  带时间戳: ['含時間戳', 'Timed', 'Mit Zeitstempeln'],
  纯文字: ['純文字', 'Plain text', 'Klartext'],
  未发现: ['未找到', 'Not found', 'Nicht gefunden'],
  '此格式可读取歌曲信息，标签写入目前支持 MP3。': [
    '此格式可讀取歌曲資訊；目前僅支援寫入 MP3 標籤。',
    'Song information can be read; tag writing currently supports MP3 only.',
    'Titelinformationen sind lesbar; Tags können derzeit nur in MP3 geschrieben werden.'
  ],
  没有读取到音频标签: ['未讀取到音訊標籤', 'No audio tags found', 'Keine Audio-Tags gefunden'],
  文件元数据: ['檔案中繼資料', 'File metadata', 'Dateimetadaten'],
  文件没有可读取的元数据: [
    '檔案沒有可讀取的中繼資料',
    'No readable metadata in this file',
    'Keine lesbaren Metadaten in dieser Datei'
  ],
  暂无自定义标签: ['暫無自訂標籤', 'No custom tags yet', 'Noch keine eigenen Tags'],
  'AI 推荐的已有标签，点击后添加：': [
    'AI 推薦的現有標籤，點選即可新增：',
    'AI suggests these existing tags. Click to add:',
    'KI empfiehlt diese vorhandenen Tags. Zum Hinzufügen anklicken:'
  ],
  编辑内容: ['編輯內容', 'Edit content', 'Inhalt bearbeiten'],
  '保存到媒体索引，不会修改原图片中的内嵌信息。': [
    '儲存至媒體索引，不會修改原圖的內嵌資訊。',
    'Saved to the media index; embedded data in the original image is unchanged.',
    'Im Medienindex gespeichert; eingebettete Daten des Originalbilds bleiben unverändert.'
  ],
  编辑正向提示词: ['編輯正向提示詞', 'Edit positive prompt', 'Positiven Prompt bearbeiten'],
  编辑负向提示词: ['編輯負向提示詞', 'Edit negative prompt', 'Negativen Prompt bearbeiten'],
  参数: ['參數', 'Parameter', 'Parameter'],
  提示词内容: ['提示詞內容', 'Prompt text', 'Prompt-Text'],
  参数值: ['參數值', 'Parameter value', 'Parameterwert'],
  'AI 建议媒体描述': [
    'AI 建議媒體描述',
    'AI suggestion for description',
    'KI-Vorschlag für Beschreibung'
  ],
  'AI 反推参考提示词': [
    'AI 反推參考提示詞',
    'AI-inferred reference prompt',
    'KI-abgeleiteter Referenzprompt'
  ],
  'AI 推荐已有标签': [
    'AI 推薦現有標籤',
    'AI suggests existing tags',
    'KI empfiehlt vorhandene Tags'
  ],
  '仅从现有的 {count} 个标签中推荐，生成后由你选择添加。': [
    '僅從現有的 {count} 個標籤中推薦，生成後由你選擇新增。',
    'Recommendations come from {count} existing tags; choose which to add.',
    'Empfehlungen stammen aus {count} vorhandenen Tags; wählen Sie aus.'
  ],
  'AI 会根据图片内容生成建议。结果先填入编辑框，请检查并手动保存。': [
    'AI 會根據圖片內容提出建議；結果會先填入編輯框，請檢查後儲存。',
    'AI drafts a suggestion from the image. Review it in the editor and save it manually.',
    'Die KI erstellt einen Bildvorschlag. Prüfen und speichern Sie ihn im Editor.'
  ],
  分析要求: ['分析要求', 'Analysis instructions', 'Analyseanweisungen'],
  '可按这次图片调整，不会修改设置中的默认模板': [
    '可針對這張圖片調整，不會修改設定中的預設範本',
    'Adjust for this image without changing the default template in Settings',
    'Für dieses Bild anpassen, ohne die Standardvorlage zu ändern'
  ],
  建议长度: ['建議長度', 'Suggested length', 'Vorschlagslänge'],
  '简短 · 80 字': ['簡短 · 80 字', 'Short · 80 characters', 'Kurz · 80 Zeichen'],
  '标准 · 120 字': ['標準 · 120 字', 'Standard · 120 characters', 'Standard · 120 Zeichen'],
  '详细 · 200 字': ['詳細 · 200 字', 'Detailed · 200 characters', 'Ausführlich · 200 Zeichen'],
  '简短 · 300 字': ['簡短 · 300 字', 'Short · 300 characters', 'Kurz · 300 Zeichen'],
  '标准 · 600 字': ['標準 · 600 字', 'Standard · 600 characters', 'Standard · 600 Zeichen'],
  '详细 · 1000 字': ['詳細 · 1000 字', 'Detailed · 1000 characters', 'Ausführlich · 1000 Zeichen'],
  生成建议: ['產生建議', 'Generate suggestion', 'Vorschlag erstellen'],
  未填写时显示文件名: [
    '未填寫時顯示檔名',
    'Show file name when empty',
    'Leer lassen, um den Dateinamen anzuzeigen'
  ],
  歌曲封面预览: ['歌曲封面預覽', 'Song cover preview', 'Cover-Vorschau'],
  替换内嵌封面: ['替換內嵌封面', 'Replace embedded cover', 'Eingebettetes Cover ersetzen'],
  移除内嵌封面: ['移除內嵌封面', 'Remove embedded cover', 'Eingebettetes Cover entfernen'],
  'JPEG、PNG、WebP · 最大 8 MB': [
    'JPEG、PNG、WebP · 最大 8 MB',
    'JPEG, PNG, WebP · max 8 MB',
    'JPEG, PNG, WebP · max. 8 MB'
  ],
  '保存将写入 MP3 标签和内嵌封面，不重新编码声音。移除内嵌封面后仍可能显示同名或目录封面。': [
    '儲存會寫入 MP3 標籤與內嵌封面，不會重新編碼聲音。移除內嵌封面後仍可能顯示同名或目錄封面。',
    'Saving updates MP3 tags and cover without re-encoding audio. A same-name or folder cover may still appear after removal.',
    'Speichern schreibt MP3-Tags und Cover ohne Audiokonvertierung. Nach dem Entfernen kann ein gleichnamiges oder Ordner-Cover erscheinen.'
  ],
  '写入 MP3 文件': ['寫入 MP3 檔案', 'Write to MP3 file', 'In MP3-Datei schreiben'],
  采样器: ['採樣器', 'Sampler', 'Sampler'],
  调度器: ['排程器', 'Scheduler', 'Scheduler'],
  步数: ['步數', 'Steps', 'Schritte'],
  提示词引导: ['提示詞引導', 'Prompt guidance', 'Prompt-Steuerung'],
  种子: ['種子', 'Seed', 'Seed'],
  生成尺寸: ['生成尺寸', 'Output size', 'Ausgabegröße'],
  'CLIP 跳过层': ['CLIP 跳過層', 'CLIP skip', 'CLIP Skip'],
  重绘幅度: ['重繪幅度', 'Denoising strength', 'Denoising-Stärke'],
  放大倍数: ['放大倍數', 'Upscale factor', 'Vergrößerungsfaktor'],
  高清修复步数: ['高清修復步數', 'Hires steps', 'Hires-Schritte'],
  '例如 Euler a': ['例如 Euler a', 'For example Euler a', 'Zum Beispiel Euler a'],
  '例如 Karras': ['例如 Karras', 'For example Karras', 'Zum Beispiel Karras'],
  '例如 20': ['例如 20', 'For example 20', 'Zum Beispiel 20'],
  '例如 7': ['例如 7', 'For example 7', 'Zum Beispiel 7'],
  '例如 0，-1 表示随机': [
    '例如 0，-1 表示隨機',
    'For example 0; -1 for random',
    'Zum Beispiel 0; -1 für zufällig'
  ],
  '例如 1024x1024': ['例如 1024x1024', 'For example 1024x1024', 'Zum Beispiel 1024x1024'],
  '例如 2': ['例如 2', 'For example 2', 'Zum Beispiel 2'],
  '0–1，例如 0.45': ['0–1，例如 0.45', '0–1, for example 0.45', '0–1, zum Beispiel 0,45'],
  '0 表示沿用步数': [
    '0 表示沿用步數',
    '0 uses the original step count',
    '0 übernimmt die ursprüngliche Schrittzahl'
  ],
  'API 模型': ['API 模型', 'API model', 'API-Modell'],
  收藏: ['收藏', 'Favorite', 'Favorisieren'],
  取消收藏: ['取消收藏', 'Remove favorite', 'Favorit entfernen'],
  恢复时间排序: ['恢復時間排序', 'Restore time order', 'Zeitliche Reihenfolge wiederherstellen'],
  已恢复按时间排序: [
    '已恢復按時間排序',
    'Time order restored',
    'Zeitliche Reihenfolge wiederhergestellt'
  ],
  自定义顺序已保存: ['自訂順序已儲存', 'Custom order saved', 'Eigene Reihenfolge gespeichert'],
  目录节点图: ['目錄節點圖', 'Folder map', 'Ordnerübersicht'],
  '{name} 的目录节点图': [
    '{name} 的目錄節點圖',
    'Folder map for {name}',
    'Ordnerübersicht für {name}'
  ],
  '{name} 的下级目录': ['{name} 的下級目錄', 'Subfolders of {name}', 'Unterordner von {name}'],
  '目录操作：{name}': ['目錄操作：{name}', 'Folder actions: {name}', 'Ordneraktionen: {name}'],
  '浏览：{name}': ['瀏覽：{name}', 'Browse: {name}', 'Durchsuchen: {name}'],
  '移动到：{name}': ['移動到：{name}', 'Move to: {name}', 'Verschieben nach: {name}'],
  已添加: ['已新增', 'Added', 'Hinzugefügt'],
  子目录: ['子目錄', 'Subfolder', 'Unterordner'],
  修改图标: ['修改圖示', 'Change icon', 'Symbol ändern'],
  改名: ['重新命名', 'Rename', 'Umbenennen'],
  移动到其他节点: ['移動到其他節點', 'Move to another folder', 'In anderen Ordner verschieben'],
  刷新下级目录: ['重新整理下級目錄', 'Refresh subfolders', 'Unterordner aktualisieren'],
  从媒体库移除: ['從媒體庫移除', 'Remove from library', 'Aus Mediathek entfernen'],
  删除空文件夹: ['刪除空資料夾', 'Delete empty folder', 'Leeren Ordner löschen'],
  '删除空文件夹：{name}': [
    '刪除空資料夾：{name}',
    'Delete empty folder: {name}',
    'Leeren Ordner löschen: {name}'
  ],
  '正在移动 {name}：点击目标节点，或拖到目标上': [
    '正在移動 {name}：點擊目標節點或拖到目標上',
    'Moving {name}: click or drop on the destination',
    '{name} wird verschoben: Ziel anklicken oder darauf ziehen'
  ],
  不能将文件夹移入自身的子目录: [
    '不能將資料夾移入自身的子目錄',
    'Cannot move a folder into its own subfolder',
    'Ein Ordner kann nicht in seinen Unterordner verschoben werden'
  ],
  无法读取拖动文件: [
    '無法讀取拖曳的檔案',
    'Could not read dragged files',
    'Gezogene Dateien konnten nicht gelesen werden'
  ],
  文件夹已移动: ['資料夾已移動', 'Folder moved', 'Ordner verschoben'],
  文件夹已改名: ['資料夾已重新命名', 'Folder renamed', 'Ordner umbenannt'],
  空文件夹已删除: ['空資料夾已刪除', 'Empty folder deleted', 'Leerer Ordner gelöscht'],
  修改文件夹名称: ['修改資料夾名稱', 'Rename folder', 'Ordner umbenennen'],
  新的文件夹名称: ['新的資料夾名稱', 'New folder name', 'Neuer Ordnername'],
  '移动文件夹？': ['移動資料夾？', 'Move folder?', 'Ordner verschieben?'],
  '将「{source}」移入「{target}」。文件和子目录会一同移动。': [
    '將「{source}」移入「{target}」。檔案與子目錄也會一同移動。',
    'Move “{source}” into “{target}”, including its files and subfolders.',
    '„{source}“ samt Dateien und Unterordnern nach „{target}“ verschieben.'
  ],
  '删除空文件夹？': ['刪除空資料夾？', 'Delete empty folder?', 'Leeren Ordner löschen?'],
  '仅删除本机空文件夹「{name}」；如有文件或子目录，请先移出内容。': [
    '僅刪除本機空資料夾「{name}」；若含檔案或子目錄，請先移出內容。',
    'Delete the empty local folder “{name}”. Move its contents out first if it is not empty.',
    'Leeren lokalen Ordner „{name}“ löschen. Vorher Inhalte entfernen.'
  ],
  删除文件夹: ['刪除資料夾', 'Delete folder', 'Ordner löschen'],
  目录图标已更新: ['目錄圖示已更新', 'Folder icon updated', 'Ordnersymbol aktualisiert'],
  '目录图标 · {name}': ['目錄圖示 · {name}', 'Folder icon · {name}', 'Ordnersymbol · {name}'],
  '选择常用图标，或上传图片自动缩放为透明背景的方形图标。': [
    '選擇常用圖示，或上傳圖片自動縮放為透明背景的方形圖示。',
    'Choose an icon or upload an image; it will be scaled to a transparent square.',
    'Symbol auswählen oder Bild hochladen; es wird auf ein transparentes Quadrat skaliert.'
  ],
  预设目录图标: ['預設目錄圖示', 'Preset folder icons', 'Vorgegebene Ordnersymbole'],
  默认: ['預設', 'Default', 'Standard'],
  磁盘: ['磁碟', 'Disk', 'Datenträger'],
  相机: ['相機', 'Camera', 'Kamera'],
  图册: ['圖冊', 'Album', 'Album'],
  归档: ['封存', 'Archive', 'Archiv'],
  项目: ['專案', 'Project', 'Projekt'],
  音乐: ['音樂', 'Music', 'Musik'],
  设计: ['設計', 'Design', 'Design'],
  分类: ['分類', 'Category', 'Kategorie'],
  个人: ['個人', 'Personal', 'Persönlich'],
  上传图片: ['上傳圖片', 'Upload image', 'Bild hochladen'],
  上传目录图标图片: ['上傳目錄圖示圖片', 'Upload folder icon image', 'Ordnersymbolbild hochladen'],
  '最大 5 MB；缩放到 80×80，保留原图比例。': [
    '最大 5 MB；縮放到 80×80，保留原圖比例。',
    'Max 5 MB; scaled to 80×80 with aspect ratio preserved.',
    'Max. 5 MB; auf 80×80 skaliert, Seitenverhältnis bleibt erhalten.'
  ],
  自定义图标预览: ['自訂圖示預覽', 'Custom icon preview', 'Vorschau des eigenen Symbols'],
  '请选择不超过 5 MB 的 PNG、JPG、WebP 或 GIF 图片': [
    '請選擇不超過 5 MB 的 PNG、JPG、WebP 或 GIF 圖片',
    'Choose a PNG, JPG, WebP or GIF image under 5 MB',
    'PNG-, JPG-, WebP- oder GIF-Bild unter 5 MB auswählen'
  ],
  '图片边长不能超过 4096 像素': [
    '圖片邊長不得超過 4096 像素',
    'Image dimensions must not exceed 4096 pixels',
    'Bildkanten dürfen 4096 Pixel nicht überschreiten'
  ],
  无法处理图片: ['無法處理圖片', 'Could not process image', 'Bild konnte nicht verarbeitet werden'],
  '图标处理后仍过大，请换一张图片': [
    '圖示處理後仍過大，請更換圖片',
    'The icon is still too large; choose another image',
    'Symbol ist weiterhin zu groß; anderes Bild wählen'
  ],
  保存目录图标失败: [
    '儲存目錄圖示失敗',
    'Could not save folder icon',
    'Ordnersymbol konnte nicht gespeichert werden'
  ],
  文件夹: ['資料夾', 'Folder', 'Ordner'],
  喜欢: ['喜歡', 'Like', 'Gefällt mir'],
  目标位置已有同名文件或文件夹: [
    '目標位置已有同名檔案或資料夾',
    'A file or folder with this name already exists at the destination',
    'Am Ziel existiert bereits eine Datei oder ein Ordner mit diesem Namen'
  ],
  '所选文件中有同名项，请分批操作': [
    '所選檔案中有同名項，請分批操作',
    'Selected files have duplicate names; handle them in separate batches',
    'Ausgewählte Dateien haben gleiche Namen; bitte getrennt bearbeiten'
  ],
  目标文件夹存在同名文件: [
    '目標資料夾已有同名檔案',
    'The destination already contains a file with this name',
    'Im Zielordner existiert bereits eine gleichnamige Datei'
  ],
  导出: ['匯出', 'Export', 'Exportieren'],
  '导出 {count} 项': ['匯出 {count} 項', 'Export {count} items', '{count} Elemente exportieren'],
  '下载到电脑（ZIP）': [
    '下載到電腦（ZIP）',
    'Download to computer (ZIP)',
    'Auf Computer herunterladen (ZIP)'
  ],
  保存到应用归档目录: [
    '儲存到應用程式封存目錄',
    'Save to app archive folder',
    'Im Archivordner der App speichern'
  ],
  '由浏览器下载到你的电脑。': [
    '由瀏覽器下載到你的電腦。',
    'Your browser downloads the archive to this computer.',
    'Der Browser lädt das Archiv auf diesen Computer herunter.'
  ],
  '保存在运行媒体库的机器上，完成后显示保存路径。': [
    '儲存在執行媒體庫的機器上，完成後顯示儲存路徑。',
    'Save on the computer running the media library and show the path afterward.',
    'Auf dem Computer mit der Medienbibliothek speichern und anschließend den Pfad anzeigen.'
  ],
  '目标目录：{path}': ['目標目錄：{path}', 'Destination: {path}', 'Zielordner: {path}'],
  '读取中…': ['讀取中…', 'Loading…', 'Lädt…'],
  '压缩 ZIP 内容': ['壓縮 ZIP 內容', 'Compress ZIP contents', 'ZIP-Inhalt komprimieren'],
  归档已保存: ['封存已儲存', 'Archive saved', 'Archiv gespeichert'],
  'ZIP 文件已保存到以下位置：': [
    'ZIP 檔案已儲存至以下位置：',
    'ZIP saved at:',
    'ZIP gespeichert unter:'
  ],
  路径已复制: ['路徑已複製', 'Path copied', 'Pfad kopiert'],
  完成: ['完成', 'Done', 'Fertig'],
  '已开始下载 ZIP': ['已開始下載 ZIP', 'ZIP download started', 'ZIP-Download gestartet'],
  加入工作区: ['加入工作區', 'Add to workspace', 'Zum Arbeitsbereich hinzufügen'],
  '将 {count} 个媒体文件加入工作区。': [
    '將 {count} 個媒體檔案加入工作區。',
    'Add {count} media files to a workspace.',
    '{count} Mediendateien einem Arbeitsbereich hinzufügen.'
  ],
  工作区: ['工作區', 'Workspace', 'Arbeitsbereich'],
  '（已搁置）': ['（已擱置）', '(paused)', '(pausiert)'],
  选择工作区: ['選擇工作區', 'Choose a workspace', 'Arbeitsbereich auswählen'],
  请先在工作台创建工作区: [
    '請先在工作台建立工作區',
    'Create a workspace first',
    'Zuerst einen Arbeitsbereich erstellen'
  ],
  加入: ['加入', 'Add', 'Hinzufügen'],
  '工作区已不存在，请重新选择': [
    '工作區已不存在，請重新選擇',
    'Workspace no longer exists. Choose another.',
    'Arbeitsbereich existiert nicht mehr. Bitte erneut auswählen.'
  ],
  所选媒体已在这个工作区中: [
    '所選媒體已在這個工作區中',
    'Selected media are already in this workspace',
    'Ausgewählte Medien sind bereits in diesem Arbeitsbereich'
  ],
  '已加入「{name}」': ['已加入「{name}」', 'Added to “{name}”', 'Zu „{name}“ hinzugefügt'],
  对比两张: ['對比兩張', 'Compare two', 'Zwei vergleichen'],
  '多图查看（{count}）': ['多圖檢視（{count}）', 'View {count} images', '{count} Bilder ansehen'],
  搜索说明: ['搜尋說明', 'Search help', 'Suchhilfe'],
  画面搜索: ['畫面搜尋', 'Visual search', 'Bildsuche'],
  文字搜索: ['文字搜尋', 'Text search', 'Textsuche'],
  '用自然语言描述画面，已选筛选条件仍然生效。': [
    '用自然語言描述畫面，已選篩選條件仍然生效。',
    'Describe the scene in natural language. Active filters still apply.',
    'Beschreiben Sie die Szene in natürlicher Sprache. Aktive Filter gelten weiterhin.'
  ],
  '查找文件名、标签和描述，不搜索路径；空格分隔多个条件。': [
    '查找檔名、標籤和描述，不搜尋路徑；空格分隔多個條件。',
    'Search file names, tags, and descriptions, not paths. Separate terms with spaces.',
    'Dateinamen, Tags und Beschreibungen durchsuchen, keine Pfade. Begriffe durch Leerzeichen trennen.'
  ],
  '支持排除词、OR、括号和带引号的短语。': [
    '支援排除詞、OR、括號與引號短語。',
    'Supports exclusions, OR, parentheses, and quoted phrases.',
    'Unterstützt Ausschlüsse, OR, Klammern und Ausdrücke in Anführungszeichen.'
  ],
  雨夜街道上的霓虹灯: [
    '雨夜街道上的霓虹燈',
    'Neon lights on a rainy night street',
    'Neonlichter auf einer Straße in regnerischer Nacht'
  ],
  逐张查看: ['逐張檢視', 'View one by one', 'Einzeln ansehen'],
  'AI 重排': ['AI 重排', 'AI rerank', 'KI-Neusortierung'],
  '对前 20 张候选图片再次排序': [
    '對前 20 張候選圖片再次排序',
    'Rerank the top 20 candidate images',
    'Die ersten 20 Bildkandidaten neu sortieren'
  ],
  'AI 重排暂不可用，请在设置中配置': [
    'AI 重排暫不可用，請至設定配置',
    'AI reranking is unavailable; configure it in Settings',
    'KI-Neusortierung ist nicht verfügbar; bitte in den Einstellungen konfigurieren'
  ],
  未分组: ['未分組', 'Ungrouped', 'Nicht gruppiert'],
  '同一分组的标签任选其一，不同分组同时满足。': [
    '同一分組的標籤任選其一，不同分組同時符合。',
    'Any selected tag can match within a group; all selected groups must match.',
    'Innerhalb einer Gruppe genügt ein Tag; alle ausgewählten Gruppen müssen zutreffen.'
  ],
  搜索所有标签: ['搜尋所有標籤', 'Search all tags', 'Alle Tags suchen'],
  画面比例: ['畫面比例', 'Aspect ratio', 'Seitenverhältnis'],
  方形: ['方形', 'Square', 'Quadratisch'],
  '竖图 2:3': ['直圖 2:3', 'Portrait 2:3', 'Hochformat 2:3'],
  '竖图 3:4': ['直圖 3:4', 'Portrait 3:4', 'Hochformat 3:4'],
  '竖图 9:16': ['直圖 9:16', 'Portrait 9:16', 'Hochformat 9:16'],
  '横图 3:2': ['橫圖 3:2', 'Landscape 3:2', 'Querformat 3:2'],
  '横图 4:3': ['橫圖 4:3', 'Landscape 4:3', 'Querformat 4:3'],
  '横图 16:9': ['橫圖 16:9', 'Landscape 16:9', 'Querformat 16:9'],
  '宽屏 21:9': ['寬螢幕 21:9', 'Widescreen 21:9', 'Breitbild 21:9'],
  挑一挑: ['挑一挑', 'Discover', 'Entdecken'],
  '从媒体库里随机遇见喜欢的内容，点开细看，顺手收藏。': [
    '從媒體庫隨機遇見喜歡的內容，點開細看並收藏。',
    'Discover something you like at random, take a closer look, and save your favorites.',
    'Entdecken Sie zufällig Medien, sehen Sie genauer hin und speichern Sie Ihre Favoriten.'
  ],
  上一批: ['上一批', 'Previous batch', 'Vorherige Auswahl'],
  换一批: ['換一批', 'New batch', 'Neue Auswahl'],
  挑选媒体类型: ['選擇媒體類型', 'Choose media type', 'Medientyp auswählen'],
  '第 {batch} 批 · {count} 项': [
    '第 {batch} 批 · {count} 項',
    'Batch {batch} · {count} items',
    'Auswahl {batch} · {count} Elemente'
  ],
  '这一类已经看完，已重新开始挑选。': [
    '這一類已看完，已重新開始挑選。',
    'You have seen everything in this category; starting over.',
    'Alle Medien dieser Kategorie wurden gezeigt; die Auswahl beginnt erneut.'
  ],
  '换一批失败，请重试': [
    '換一批失敗，請重試',
    'Could not load another batch; try again',
    'Eine weitere Auswahl konnte nicht geladen werden; bitte erneut versuchen'
  ],
  读取媒体失败: ['讀取媒體失敗', 'Could not load media', 'Medien konnten nicht geladen werden'],
  正在挑选媒体: ['正在挑選媒體', 'Choosing media', 'Medien werden ausgewählt'],
  还没有可挑选的媒体: [
    '還沒有可挑選的媒體',
    'No media to discover yet',
    'Noch keine Medien zum Entdecken'
  ],
  '请先在媒体库中添加目录并扫描。': [
    '請先在媒體庫新增資料夾並掃描。',
    'Add a folder to the media library and scan it first.',
    'Fügen Sie der Mediathek zuerst einen Ordner hinzu und erfassen Sie ihn.'
  ],
  收藏更新失败: [
    '更新收藏失敗',
    'Could not update favorite',
    'Favorit konnte nicht aktualisiert werden'
  ],
  标签读取失败: ['讀取標籤失敗', 'Could not load tags', 'Tags konnten nicht geladen werden'],
  标签更新失败: ['更新標籤失敗', 'Could not update tags', 'Tags konnten nicht aktualisiert werden'],
  '取消收藏：{name}': [
    '取消收藏：{name}',
    'Remove {name} from favorites',
    '{name} aus Favoriten entfernen'
  ],
  '收藏：{name}': ['收藏：{name}', 'Add {name} to favorites', '{name} zu Favoriten hinzufügen'],
  '编辑标签 · {name}': ['編輯標籤 · {name}', 'Edit tags · {name}', 'Tags bearbeiten · {name}'],
  已收藏: ['已收藏', 'Favorited', 'Favorit']
}

const indexes = { zhHant: 0, en: 1, de: 2 } as const

export function useMediaText() {
  const { language } = useLanguage()
  return useCallback(
    (key: string, values?: Record<string, string | number>) => {
      const translated = language === 'zhHans' ? key : translations[key]?.[indexes[language]] || key
      return translated.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''))
    },
    [language]
  )
}
