import { Input, Modal, message } from 'ant-design-vue'
import { ref } from 'vue'

import { t } from '@/shared/i18n/index'

import { addCustomTag, getDbBasicInfo } from '@/features/media-library/api/library'

import { useApplicationStore } from '@/features/application/public'

export const openAddNewTagModal = () => {
  const name = ref('')
  const global = useApplicationStore()
  return new Promise<string>((resolve) => {
    Modal.confirm({
      title: t('addNewCustomTag'),
      content: () => <Input v-model:value={name.value} />,
      async onOk() {
        if (!name.value) {
          return
        }
        const info = await getDbBasicInfo()
        const tag = await addCustomTag({ tag_name: name.value })
        if (tag.type !== 'custom') {
          message.error(t('existInOtherType'))
          throw new Error(t('existInOtherType'))
        }
        if (info.tags.find((v) => v.id === tag.id)) {
          message.error(t('alreadyExists'))
          throw new Error(t('alreadyExists'))
        } else {
          global.conf?.all_custom_tags.push(tag)
          message.success(t('success'))
        }
        resolve(name.value)
      }
    })
  })
}
