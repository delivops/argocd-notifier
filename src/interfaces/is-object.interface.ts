export const isObject = <T>(value: T): value is T & Record<string | number, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
