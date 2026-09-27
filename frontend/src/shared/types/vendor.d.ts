declare module 'multi-nprogress' {
  import type { NProgress as BaseProgress, NProgressOptions } from 'nprogress'
  // multi-nprogress accepts a DOM element as well as a selector for its parent.
  export interface NProgress extends Omit<BaseProgress, 'configure'> {
    configure(
      options: Partial<Omit<NProgressOptions, 'parent'>> & { parent?: string | HTMLElement }
    ): NProgress
  }
  const Progress: new () => NProgress
  export default Progress
}
