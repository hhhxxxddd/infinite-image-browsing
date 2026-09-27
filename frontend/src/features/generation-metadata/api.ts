import { axiosInst } from '@/shared/api/httpClient'

export const getImageGenerationInfo = async (path: string) => {
  return (await axiosInst.value.get(`/image_geninfo?path=${encodeURIComponent(path)}`))
    .data as string
}

export const updateExif = async (path: string, exif: string) => {
  const resp = await axiosInst.value.post('/update_exif', { path, exif })
  return resp.data as { success: boolean; message: string }
}

export const getImageExif = async (path: string) => {
  return (await axiosInst.value.get(`/image_exif?path=${encodeURIComponent(path)}`)).data as Record<
    string,
    string
  >
}

export const getImageGenerationInfoBatch = async (paths: string[]) => {
  if (!paths.length) {
    return {}
  }
  const resp = await axiosInst.value.post('/image_geninfo_batch', { paths })
  return resp.data
}
