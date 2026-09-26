import { onBeforeUnmount, ref, watch, type InjectionKey, type Ref } from 'vue'
import { createStudioTask, listStudioTasks, type StudioTask } from '@/api/studioTasks'

export const workspaceTasksKey: InjectionKey<Ref<StudioTask[]>> = Symbol('workspace-tasks')
const revision = ref(0)
export async function submitWorkspaceTask(...args: Parameters<typeof createStudioTask>) {
  const task = await createStudioTask(...args)
  revision.value++
  return task
}

export function useWorkspaceTasks(workspaceId: () => string | undefined) {
  const tasks = ref<StudioTask[]>([])
  const error = ref('')
  let timer: ReturnType<typeof setTimeout> | undefined
  let version = 0
  watch([workspaceId, revision], async ([id], previous) => {
    const request = ++version
    clearTimeout(timer)
    if (id !== previous?.[0]) { tasks.value = []; error.value = '' }
    if (!id) return
    async function refresh() {
      try {
        const result = await listStudioTasks(id!)
        if (request !== version) return
        tasks.value = result
        error.value = ''
      } catch {
        if (request !== version) return
        error.value = '暂时无法更新任务状态，正在重试'
      }
      if (request === version) timer = setTimeout(refresh,
        tasks.value.some(task => task.state === 'queued' || task.state === 'running') ? 2000 : 15000)
    }
    await refresh()
  }, { immediate: true })
  onBeforeUnmount(() => { version++; clearTimeout(timer) })
  return { tasks, error }
}
