export function childFolderPath(parent: string, input: string, windows = false) {
  const name = input.trim()
  if (!name || name === '.' || name === '..') throw new Error('请输入有效的文件夹名称')
  if (/[\\/\x00-\x1f]/.test(name)) throw new Error('请输入单个文件夹名称，不要包含路径分隔符')
  if (windows && (/[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))) {
    throw new Error('此名称不能用于 Windows 文件夹')
  }
  const separator = windows ? '\\' : '/'
  return parent.replace(/[\\/]+$/, '') + separator + name
}
