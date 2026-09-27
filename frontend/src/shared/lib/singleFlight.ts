type AsyncFunction<This, Args extends unknown[], Result> = (
  this: This,
  ...args: Args
) => Promise<Result>

/** Share the current invocation; later calls run again once it settles. */
export function makeAsyncFunctionSingle<This, Args extends unknown[], Result>(
  fn: AsyncFunction<This, Args, Result>
): AsyncFunction<This, Args, Result> {
  let promise: Promise<Result> | null = null
  return function (this: This, ...args: Args): Promise<Result> {
    if (promise) return promise
    promise = Promise.resolve()
      .then(() => fn.apply(this, args))
      .finally(() => {
        promise = null
      })
    return promise
  }
}
