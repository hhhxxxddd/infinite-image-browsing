export type Dict<T = unknown> = Record<string, T>
export type ReturnTypeAsync<T extends (...args: never[]) => Promise<unknown>> = Awaited<
  ReturnType<T>
>
