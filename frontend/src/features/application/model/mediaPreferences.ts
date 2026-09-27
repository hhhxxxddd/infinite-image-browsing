export const SortMethod = {
  DATE_ASC: 'date-asc',
  DATE_DESC: 'date-desc',
  NAME_ASC: 'name-asc',
  NAME_DESC: 'name-desc',
  SIZE_ASC: 'size-asc',
  SIZE_DESC: 'size-desc',
  CREATED_TIME_ASC: 'created-time-asc',
  CREATED_TIME_DESC: 'created-time-desc',
  SHUFFLE: 'shuffle'
} as const

export type SortMethod = (typeof SortMethod)[keyof typeof SortMethod]
