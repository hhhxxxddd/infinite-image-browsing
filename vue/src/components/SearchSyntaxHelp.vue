<script setup lang="ts">
import { ref } from 'vue'
import { QuestionCircleOutlined } from '@ant-design/icons-vue'

defineProps<{ iconOnly?: boolean, semanticMode?: boolean }>()
const emit = defineEmits<{ example: [query: string] }>()
const open = ref(false)
const examples = [
  { query: 'tag:风景 -tag:模糊', meaning: '有“风景”标签，排除“模糊”' },
  { query: '(tag:风景 OR tag:城市) desc:夜景', meaning: '标签二选一，描述包含“夜景”' },
  { query: 'name:"IMG 001" has:desc', meaning: '文件名包含短语，并且有描述' },
]
function choose(query: string) {
  open.value = false
  emit('example', query)
}
</script>

<template>
  <a-popover v-model:open="open" trigger="click" placement="bottomLeft">
    <template #content>
      <div class="syntax-help" @click.stop>
        <template v-if="semanticMode">
          <strong>画面搜索</strong>
          <p>用自然语言描述想找的画面，按 Enter 搜索。下方可选择 AI 重排，并查看或更新已索引的图片。</p>
          <p>已选的筛选条件会继续生效；文字搜索词会在切回文字模式后恢复。</p>
          <strong>例如</strong>
          <button type="button" class="syntax-example" @click="choose('雨夜街道上的霓虹灯')"><span>雨夜街道上的霓虹灯</span></button>
        </template>
        <template v-else>
        <strong>文字搜索</strong>
        <p>查找文件名、标签和描述，不搜索路径。多个词用空格隔开，表示同时满足。</p>
        <dl>
          <div><dt><code>tag:</code> <code>name:</code> <code>desc:</code></dt><dd>限定标签、文件名或描述</dd></div>
          <div><dt><code>-</code> <code>OR</code> <code>( )</code></dt><dd>排除、任选或分组</dd></div>
          <div><dt><code>"两个词"</code> <code>has:desc</code></dt><dd>完整短语；筛选已有描述</dd></div>
        </dl>
        <strong>点击示例搜索</strong>
        <button v-for="item in examples" :key="item.query" type="button" class="syntax-example" @click="choose(item.query)">
          <code>{{ item.query }}</code><span>{{ item.meaning }}</span>
        </button>
        <p class="syntax-note">当前搜索框使用上方的文字指令，不支持正则表达式。AI 画面搜索请点机器人图标。</p>
        </template>
      </div>
    </template>
    <button type="button" class="syntax-help-trigger" :title="semanticMode ? '画面搜索说明' : '文字搜索说明'" :aria-label="semanticMode ? '画面搜索说明' : '文字搜索说明'" @click.stop>
      <QuestionCircleOutlined /><span v-if="!iconOnly">搜索说明</span>
    </button>
  </a-popover>
</template>

<style scoped>
.syntax-help-trigger{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:28px;min-height:28px;padding:3px 7px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap;}
.syntax-help-trigger:hover{background:#8882;}
.syntax-help{width:min(360px,80vw);max-height:min(620px,75vh);overflow:auto;font-size:12px;line-height:1.5;}
.syntax-help>strong{display:block;margin:4px 0 7px;font-size:13px;}
.syntax-help p{margin:0 0 9px;color:#888;}
.syntax-help dl{margin:0 0 12px;}
.syntax-help dl>div{display:grid;grid-template-columns:150px 1fr;gap:6px;padding:5px 0;border-top:1px solid #8882;}
.syntax-help dt,.syntax-help dd{margin:0;}
.syntax-help code{font-family:ui-monospace,monospace;overflow-wrap:anywhere;}
.syntax-example{display:flex;width:100%;flex-direction:column;align-items:flex-start;gap:1px;margin:3px 0;padding:6px 8px;border:1px solid #8883;border-radius:5px;background:transparent;color:inherit;text-align:left;cursor:pointer;}
.syntax-example:hover{border-color:#488bd5;background:#488bd512;}
.syntax-example span,.syntax-note{color:#888;}
</style>
