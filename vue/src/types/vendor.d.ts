declare module 'jian-pinyin' {
  export function getSpell(text: string): string | string[]
}

declare module 'multi-nprogress' {
  import type { NProgress } from 'nprogress'
  const Progress: new () => NProgress
  export default Progress
}
