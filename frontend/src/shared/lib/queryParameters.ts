export function removeQueryParams(keys: string[]): string {
  // 获取当前 URL
  const url: string = parent.location.href

  // 解析 URL，获取查询参数部分
  const searchParams: URLSearchParams = new URLSearchParams(parent.location.search)

  // 删除指定的键
  keys.forEach((key: string) => {
    searchParams.delete(key)
  })

  // 构建新的 URL
  const newUrl: string = `${url.split('?')[0]}${
    searchParams.size ? '?' : ''
  }${searchParams.toString()}`

  // 使用 pushState() 方法将新 URL 添加到浏览器历史记录中
  parent.history.pushState(null, '', newUrl)

  // 返回新的 URL
  return newUrl
}
