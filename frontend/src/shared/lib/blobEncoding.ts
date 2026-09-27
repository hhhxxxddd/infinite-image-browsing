/** Read a binary payload for JSON APIs that accept base64 without a data URL prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(new Error('无法读取文件内容'))
    reader.readAsDataURL(blob)
  })
}
