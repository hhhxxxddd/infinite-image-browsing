import { useNotice } from '../../shared/notices'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconChevronDown,
  IconEdit,
  IconFolderPlus,
  IconPlus,
  IconSearch,
  IconTrash
} from '@tabler/icons-react'
import { apiFetch } from '../../shared/apiClient'
import { useLanguage } from '../../design/i18n'
import { getLibraryInfo, type MediaTag } from '../media/mediaApi'
import { errorText, SettingsCard } from './components'

type RuleFilter = { field: string; operator: string; value: string }
type AutoRule = { tag: string; filters: RuleFilter[] }
type GlobalSetting = {
  is_readonly: boolean
  app_fe_setting?: { auto_tag_rules?: AutoRule[] }
}

const fields = [
  { value: 'pos_prompt', key: 'autoTag.fields.posPrompt' },
  { value: 'neg_prompt', key: 'autoTag.fields.negPrompt' },
  { value: 'Model', key: 'autoTag.fields.model' },
  { value: 'lora', key: 'autoTag.fields.lora' },
  { value: 'Sampler', key: 'autoTag.fields.sampler' },
  { value: 'Source Identifier', key: 'autoTag.fields.source' },
  { value: 'Size', key: 'autoTag.fields.size' },
  { value: 'CFG scale', key: 'autoTag.fields.cfgScale' },
  { value: 'Steps', key: 'autoTag.fields.steps' },
  { value: 'Seed', key: 'autoTag.fields.seed' }
] as const
const operators = [
  { value: 'contains', key: 'autoTag.operators.contains' },
  { value: 'equals', key: 'autoTag.operators.equals' },
  { value: 'regex', key: 'autoTag.operators.regex' }
] as const

const post = <T,>(path: string, body: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) })
const labelFor = (tag: MediaTag) => tag.display_name || tag.name
const colorFor = (color: string) => (/^#[\da-f]{6}$/i.test(color) ? color : '#2673bd')
const groupPageSize = 12
const tagPageSize = 40

export default function TagSettings() {
  const { t } = useLanguage()
  const [tags, setTags] = useState<MediaTag[]>([])
  const [groupNames, setGroupNames] = useState<string[]>([])
  const [rules, setRules] = useState<AutoRule[]>([])
  const [savedRules, setSavedRules] = useState<AutoRule[]>([])
  const [readonly, setReadonly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setNotice = useNotice()
  const [search, setSearch] = useState('')
  const [visibleGroupCount, setVisibleGroupCount] = useState(groupPageSize)
  const [tagPages, setTagPages] = useState<Record<string, number>>({})
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [draggedTagId, setDraggedTagId] = useState<string | null>(null)
  const [dropGroup, setDropGroup] = useState<string | null>(null)
  const initialGroupAssigned = useRef(false)
  const [newGroup, setNewGroup] = useState('')
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [newTags, setNewTags] = useState<Record<string, string>>({})
  const [rename, setRename] = useState<{
    kind: 'group' | 'tag'
    id: string | number
    value: string
  } | null>(null)
  const [remove, setRemove] = useState<{
    kind: 'group' | 'tag'
    id: string | number
    label: string
  } | null>(null)

  const refresh = useCallback(async (preserveRuleDraft = false) => {
    const [info, groups, global] = await Promise.all([
      getLibraryInfo(),
      apiFetch<string[]>('/tag_groups'),
      apiFetch<GlobalSetting>('/global_setting')
    ])
    setTags(info.tags.filter((tag) => tag.type === 'custom'))
    setGroupNames(groups)
    if (!initialGroupAssigned.current) {
      const custom = info.tags.filter((tag) => tag.type === 'custom')
      const first = ['', ...groups].find((name) =>
        custom.some((tag) => (tag.group_name || '') === name)
      )
      setOpenGroup(first ?? '')
      initialGroupAssigned.current = true
    }
    const latest = global.app_fe_setting?.auto_tag_rules || []
    if (!preserveRuleDraft) setRules(structuredClone(latest))
    setSavedRules(structuredClone(latest))
    setReadonly(global.is_readonly)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh().catch((cause: unknown) => {
      setError(errorText(cause, '读取标签设置失败'))
      setLoading(false)
    })
  }, [refresh])

  const groups = useMemo(() => {
    const names = ['', ...groupNames]
    const query = search.trim().toLocaleLowerCase()
    return names
      .map((name) => {
        const all = tags.filter((tag) => (tag.group_name || '') === name)
        const matches = query
          ? all.filter((tag) => `${labelFor(tag)} ${tag.name}`.toLocaleLowerCase().includes(query))
          : all
        return {
          name,
          tags: query && name.toLocaleLowerCase().includes(query) ? all : matches,
          total: all.length
        }
      })
      .filter(
        (group) => !query || group.tags.length || group.name.toLocaleLowerCase().includes(query)
      )
  }, [groupNames, search, tags])

  const ruleTagNames = useMemo(() => new Set(savedRules.map((rule) => rule.tag)), [savedRules])
  const ruleDirty = JSON.stringify(rules) !== JSON.stringify(savedRules)

  async function mutate(action: () => Promise<unknown>, success: string, preserveRuleDraft = true) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
      await refresh(preserveRuleDraft)
      setNotice(success)
      return true
    } catch (cause) {
      setError(errorText(cause, '保存失败'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function createGroup() {
    const name = newGroup.trim()
    if (!name || name === '未分组' || groupNames.includes(name)) {
      setError('请输入未使用过的分组名称；“未分组”是固定分组。')
      return
    }
    if (await mutate(() => post('/create_tag_group', { name }), '分组已创建')) {
      setNewGroup('')
      setShowNewGroup(false)
      setOpenGroup(name)
      setSearch(name)
    }
  }

  async function addTag(groupName: string) {
    const name = (newTags[groupName] || '').trim()
    if (!name || tags.some((tag) => tag.name === name || labelFor(tag) === name)) {
      setError('请输入未使用过的标签名称。')
      return
    }
    if (
      await mutate(
        () => post('/add_custom_tag', { tag_name: name, group_name: groupName }),
        '标签已添加'
      )
    )
      setNewTags((current) => ({ ...current, [groupName]: '' }))
  }

  function resetTagDrag() {
    setDraggedTagId(null)
    setDropGroup(null)
  }

  async function dropTag(event: DragEvent<HTMLElement>, groupName: string) {
    if (readonly || busy || draggedTagId === null) return
    event.preventDefault()
    const id = event.dataTransfer.getData('application/x-omnigallery-tag-id') || draggedTagId
    resetTagDrag()
    const tag = tags.find((item) => String(item.id) === id)
    if (!tag || (tag.group_name || '') === groupName) return
    await mutate(
      () => post('/update_tag', { id: tag.id, group_name: groupName }),
      `已将“${labelFor(tag)}”移至${groupName || '未分组'}`
    )
  }

  async function saveRename() {
    if (!rename) return
    const name = rename.value.trim()
    if (!name || name === '未分组') {
      setError('请输入有效的名称。')
      return
    }
    let saved = false
    if (rename.kind === 'group') {
      saved = await mutate(
        () => post('/rename_tag_group', { name: rename.id, new_name: name }),
        '分组已改名'
      )
      if (saved) setOpenGroup(name)
    } else {
      const previousName = tags.find((tag) => tag.id === rename.id)?.name
      saved = await mutate(() => post('/rename_custom_tag', { id: rename.id, name }), '标签已改名')
      if (saved && previousName)
        setRules((current) =>
          current.map((rule) => (rule.tag === previousName ? { ...rule, tag: name } : rule))
        )
    }
    if (saved) setRename(null)
  }

  async function confirmRemove() {
    if (!remove) return
    const removed =
      remove.kind === 'group'
        ? await mutate(
            () => post('/delete_tag_group', { name: remove.id }),
            '分组已删除，标签已移回未分组'
          )
        : await mutate(() => post('/remove_custom_tag', { tag_id: remove.id }), '标签已删除')
    if (removed) setRemove(null)
  }

  function updateRule(index: number, patch: Partial<AutoRule>) {
    setRules((current) => current.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)))
  }
  function updateFilter(ruleIndex: number, filterIndex: number, patch: Partial<RuleFilter>) {
    setRules((current) =>
      current.map((rule, at) =>
        at !== ruleIndex
          ? rule
          : {
              ...rule,
              filters: rule.filters.map((filter, position) =>
                position === filterIndex ? { ...filter, ...patch } : filter
              )
            }
      )
    )
  }

  async function saveRules() {
    if (
      rules.some(
        (rule) =>
          !tags.some((tag) => tag.name === rule.tag) ||
          !rule.filters.length ||
          rule.filters.some((filter) => !filter.value.trim())
      )
    ) {
      setError('请为每条规则选择标签，并填写至少一个完整条件。')
      return
    }
    await mutate(
      () => post('/app_fe_setting', { name: 'auto_tag_rules', value: JSON.stringify(rules) }),
      '自动打标规则已保存；新规则将在下次扫描时生效',
      false
    )
  }

  return (
    <div className="settings-stack">
      {error && (
        <Alert color="red" variant="light" onClose={() => setError('')} withCloseButton>
          {error}
        </Alert>
      )}
      <SettingsCard
        title={t('tagManagement')}
        description="为媒体建立可检索的分组与标签；删除分组时，标签会移回未分组。"
      >
        <Group justify="space-between" mb="lg" align="flex-end">
          <TextInput
            placeholder="搜索标签或分组"
            leftSection={<IconSearch size={15} />}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value)
              setVisibleGroupCount(groupPageSize)
              setTagPages({})
              setOpenGroup(null)
            }}
            aria-label="搜索标签或分组"
            w={320}
          />
          <Group gap="sm">
            <Text size="xs" c="dimmed">
              {tags.length} 个标签 · {groups.length} 个分组
            </Text>
            <Button
              variant="light"
              leftSection={<IconFolderPlus size={16} />}
              disabled={readonly || busy}
              onClick={() => setShowNewGroup((value) => !value)}
            >
              新增分组
            </Button>
          </Group>
        </Group>
        {showNewGroup && (
          <Group mb="lg" className="settings-inline-create">
            <TextInput
              placeholder="新分组名称"
              value={newGroup}
              maxLength={40}
              onChange={(event) => setNewGroup(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void createGroup()
              }}
              aria-label="新分组名称"
            />
            <Button disabled={!newGroup.trim() || busy} onClick={() => void createGroup()}>
              创建
            </Button>
            <Button variant="default" onClick={() => setShowNewGroup(false)}>
              取消
            </Button>
          </Group>
        )}
        {loading ? (
          <Text c="dimmed">正在读取标签…</Text>
        ) : groups.length === 0 ? (
          <Text c="dimmed">没有匹配的标签或分组。</Text>
        ) : (
          <div className="settings-tag-groups">
            {groups.slice(0, visibleGroupCount).map((group) => {
              const open = openGroup === group.name || (!!search && openGroup === null)
              const pageCount = Math.max(1, Math.ceil(group.tags.length / tagPageSize))
              const page = Math.min(tagPages[group.name] || 1, pageCount)
              return (
                <section
                  key={group.name}
                  className="settings-tag-group"
                  data-drop-target={draggedTagId !== null && dropGroup === group.name}
                  onDragOver={(event) => {
                    if (readonly || busy || draggedTagId === null) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropGroup(group.name)
                  }}
                  onDragLeave={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget as Node))
                      setDropGroup(null)
                  }}
                  onDrop={(event) => void dropTag(event, group.name)}
                >
                  <div className="settings-tag-group-header">
                    <button
                      type="button"
                      className="settings-tag-group-toggle"
                      aria-expanded={open}
                      onClick={() => setOpenGroup(open ? null : group.name)}
                    >
                      <IconChevronDown size={15} className={open ? 'is-open' : ''} />
                      <strong>{group.name || '未分组'}</strong>
                      <Badge size="sm" variant="light" color="gray">
                        {group.tags.length} / {group.total}
                      </Badge>
                    </button>
                    {group.name && (
                      <Group gap={4}>
                        <Tooltip label="重命名分组">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            aria-label={`重命名分组：${group.name}`}
                            disabled={readonly || busy}
                            onClick={() =>
                              setRename({ kind: 'group', id: group.name, value: group.name })
                            }
                          >
                            <IconEdit size={16} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label="删除分组">
                          <ActionIcon
                            variant="subtle"
                            color="red"
                            aria-label={`删除分组：${group.name}`}
                            disabled={readonly || busy}
                            onClick={() =>
                              setRemove({ kind: 'group', id: group.name, label: group.name })
                            }
                          >
                            <IconTrash size={16} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    )}
                  </div>
                  {open && (
                    <div className="settings-tag-group-body">
                      {group.tags.length === 0 && (
                        <Text size="xs" c="dimmed">
                          这个分组还没有标签。
                        </Text>
                      )}
                      {group.tags.slice((page - 1) * tagPageSize, page * tagPageSize).map((tag) => {
                        const protectedTag = tag.name === 'like'
                        return (
                          <div
                            className="settings-tag-row"
                            key={tag.id}
                            draggable={!readonly && !busy}
                            data-dragging={draggedTagId === String(tag.id)}
                            aria-label={`拖动 ${labelFor(tag)} 到其他分组`}
                            onDragStart={(event) => {
                              if (readonly || busy) {
                                event.preventDefault()
                                return
                              }
                              const id = String(tag.id)
                              setDraggedTagId(id)
                              event.dataTransfer.setData('application/x-omnigallery-tag-id', id)
                              event.dataTransfer.effectAllowed = 'move'
                            }}
                            onDragEnd={resetTagDrag}
                          >
                            <label
                              className="settings-tag-color"
                              title={`设置 ${labelFor(tag)} 的颜色`}
                            >
                              <input
                                type="color"
                                value={colorFor(tag.color)}
                                disabled={readonly || busy}
                                aria-label={`设置 ${labelFor(tag)} 的颜色`}
                                onChange={(event) => {
                                  const color = event.currentTarget.value
                                  void mutate(
                                    () => post('/update_tag', { id: tag.id, color }),
                                    '标签颜色已更新'
                                  )
                                }}
                              />
                            </label>
                            <span className="settings-tag-name" title={labelFor(tag)}>
                              {labelFor(tag)}
                            </span>
                            {protectedTag && (
                              <Badge size="xs" variant="light">
                                内置
                              </Badge>
                            )}
                            {ruleTagNames.has(tag.name) && (
                              <Badge size="xs" variant="light" color="orange">
                                规则
                              </Badge>
                            )}
                            <span className="settings-tag-row-spacer" />
                            <Select
                              size="xs"
                              w={132}
                              aria-label={`移动标签 ${labelFor(tag)} 到分组`}
                              value={tag.group_name || '__ungrouped__'}
                              data={[
                                { value: '__ungrouped__', label: '未分组' },
                                ...groupNames.map((name) => ({ value: name, label: name }))
                              ]}
                              disabled={readonly || busy}
                              onChange={(value) =>
                                value &&
                                void mutate(
                                  () =>
                                    post('/update_tag', {
                                      id: tag.id,
                                      group_name: value === '__ungrouped__' ? '' : value
                                    }),
                                  '标签已移动'
                                )
                              }
                            />
                            <ActionIcon
                              variant="subtle"
                              color="gray"
                              aria-label={`重命名标签：${labelFor(tag)}`}
                              disabled={readonly || busy || protectedTag}
                              onClick={() =>
                                setRename({ kind: 'tag', id: tag.id, value: tag.name })
                              }
                            >
                              <IconEdit size={16} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`删除标签：${labelFor(tag)}`}
                              disabled={
                                readonly || busy || protectedTag || ruleTagNames.has(tag.name)
                              }
                              onClick={() =>
                                setRemove({ kind: 'tag', id: tag.id, label: labelFor(tag) })
                              }
                            >
                              <IconTrash size={16} />
                            </ActionIcon>
                          </div>
                        )
                      })}
                      {pageCount > 1 && (
                        <Group justify="flex-end" gap="xs" mt="sm">
                          <Button
                            size="xs"
                            variant="subtle"
                            disabled={page <= 1}
                            onClick={() =>
                              setTagPages((current) => ({ ...current, [group.name]: page - 1 }))
                            }
                          >
                            上一页
                          </Button>
                          <Text size="xs" c="dimmed">
                            {page} / {pageCount}
                          </Text>
                          <Button
                            size="xs"
                            variant="subtle"
                            disabled={page >= pageCount}
                            onClick={() =>
                              setTagPages((current) => ({ ...current, [group.name]: page + 1 }))
                            }
                          >
                            下一页
                          </Button>
                        </Group>
                      )}
                      <Group mt="sm" className="settings-inline-create">
                        <TextInput
                          placeholder={`在${group.name || '未分组'}中添加标签`}
                          aria-label={`在${group.name || '未分组'}中添加标签`}
                          maxLength={40}
                          value={newTags[group.name] || ''}
                          onChange={(event) => {
                            const value = event.currentTarget.value
                            setNewTags((current) => ({ ...current, [group.name]: value }))
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void addTag(group.name)
                          }}
                          disabled={readonly || busy}
                        />
                        <Button
                          variant="light"
                          leftSection={<IconPlus size={15} />}
                          disabled={readonly || busy || !(newTags[group.name] || '').trim()}
                          onClick={() => void addTag(group.name)}
                        >
                          添加标签
                        </Button>
                      </Group>
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
        {groups.length > visibleGroupCount && (
          <Button
            variant="subtle"
            mt="md"
            onClick={() => setVisibleGroupCount((count) => count + groupPageSize)}
          >
            再显示 {Math.min(groupPageSize, groups.length - visibleGroupCount)} 个分组
          </Button>
        )}
      </SettingsCard>

      <SettingsCard
        title={t('autoTagRules')}
        description="扫描或重建索引时，只有一条规则的全部条件满足，才会添加对应标签。"
      >
        <Group justify="flex-end" mb="md">
          <Button
            variant="light"
            leftSection={<IconPlus size={16} />}
            disabled={readonly || busy}
            onClick={() =>
              setRules((current) => [
                ...current,
                { tag: '', filters: [{ field: 'pos_prompt', operator: 'contains', value: '' }] }
              ])
            }
          >
            {t('autoTag.addRule')}
          </Button>
        </Group>
        <Stack gap="sm">
          {rules.length === 0 && (
            <Text size="sm" c="dimmed">
              暂无自动打标规则。
            </Text>
          )}
          {rules.map((rule, index) => (
            <div className="settings-rule-card" key={index}>
              <Group justify="space-between" mb="sm">
                <Group gap="sm">
                  <Badge variant="light">规则 {index + 1}</Badge>
                  <Text size="sm" fw={600}>
                    添加标签
                  </Text>
                </Group>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={`删除规则 ${index + 1}`}
                  disabled={readonly || busy}
                  onClick={() => setRules((current) => current.filter((_, at) => at !== index))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
              <Select
                searchable
                placeholder="选择标签"
                aria-label={`规则 ${index + 1} 的标签`}
                value={rule.tag || null}
                onChange={(value) => updateRule(index, { tag: value || '' })}
                data={tags.map((tag) => ({ value: tag.name, label: labelFor(tag) }))}
                disabled={readonly || busy}
                mb="sm"
              />
              <Stack gap="xs">
                {rule.filters.map((filter, filterIndex) => (
                  <Group key={filterIndex} gap="xs" wrap="nowrap" className="settings-rule-filter">
                    <Select
                      aria-label={`规则 ${index + 1} 条件 ${filterIndex + 1} 字段`}
                      value={filter.field}
                      onChange={(value) =>
                        value && updateFilter(index, filterIndex, { field: value })
                      }
                      data={fields.map((field) => ({ value: field.value, label: t(field.key) }))}
                      disabled={readonly || busy}
                    />
                    <Select
                      aria-label={`规则 ${index + 1} 条件 ${filterIndex + 1} 运算符`}
                      value={filter.operator}
                      onChange={(value) =>
                        value && updateFilter(index, filterIndex, { operator: value })
                      }
                      data={operators.map((operator) => ({
                        value: operator.value,
                        label: t(operator.key)
                      }))}
                      disabled={readonly || busy}
                    />
                    <TextInput
                      aria-label={`规则 ${index + 1} 条件 ${filterIndex + 1} 匹配内容`}
                      placeholder="匹配内容"
                      value={filter.value}
                      onChange={(event) =>
                        updateFilter(index, filterIndex, { value: event.currentTarget.value })
                      }
                      disabled={readonly || busy}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`删除规则 ${index + 1} 条件 ${filterIndex + 1}`}
                      disabled={readonly || busy}
                      onClick={() =>
                        updateRule(index, {
                          filters: rule.filters.filter((_, at) => at !== filterIndex)
                        })
                      }
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconPlus size={14} />}
                disabled={readonly || busy}
                mt="sm"
                onClick={() =>
                  updateRule(index, {
                    filters: [
                      ...rule.filters,
                      { field: 'pos_prompt', operator: 'contains', value: '' }
                    ]
                  })
                }
              >
                {t('autoTag.addFilter')}
              </Button>
            </div>
          ))}
        </Stack>
        <Group justify="space-between" mt="lg">
          <Text size="xs" c="dimmed">
            {ruleDirty ? '有未保存更改' : '规则已保存'}
          </Text>
          <Button
            disabled={readonly || busy || !ruleDirty}
            loading={busy}
            onClick={() => void saveRules()}
          >
            {t('autoTag.saveConfig')}
          </Button>
        </Group>
      </SettingsCard>

      <Modal
        opened={!!rename}
        onClose={() => setRename(null)}
        title={rename?.kind === 'group' ? '重命名分组' : '重命名标签'}
        centered
      >
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}
        <TextInput
          autoFocus
          label="新名称"
          maxLength={40}
          value={rename?.value || ''}
          onChange={(event) => {
            const value = event.currentTarget.value
            setRename((current) => (current ? { ...current, value } : null))
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void saveRename()
          }}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setRename(null)}>
            取消
          </Button>
          <Button disabled={busy || !rename?.value.trim()} onClick={() => void saveRename()}>
            保存
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={!!remove}
        onClose={() => setRemove(null)}
        title={`删除${remove?.kind === 'group' ? '分组' : '标签'}`}
        centered
      >
        {error && (
          <Alert color="red" mb="md">
            {error}
          </Alert>
        )}
        <Text size="sm">
          {remove?.kind === 'group'
            ? `删除分组“${remove.label}”后，里面的标签会移回未分组。`
            : `删除标签“${remove?.label}”及其媒体关联？媒体文件本身会保留。`}
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setRemove(null)}>
            取消
          </Button>
          <Button color="red" loading={busy} onClick={() => void confirmRemove()}>
            删除
          </Button>
        </Group>
      </Modal>
    </div>
  )
}
