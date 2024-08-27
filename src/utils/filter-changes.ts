import type { DeepPartial } from '@/interfaces/deep-partial';
import { deepCompare } from './deep-compare';
import { isObject } from './is-object';

export function filterChanges<T extends object>(partial: DeepPartial<T>, original: T): DeepPartial<T> {
  const changes: DeepPartial<T> = {};

  if (!isObject(partial) || !isObject(original)) {
    throw new Error('Both partial and original must be objects');
  }

  for (const key in partial) {
    const originalValue = original[key];
    const partialValue = partial[key];

    if (deepCompare(partialValue, originalValue, { allowMissingAsUndefined: true })) {
      continue;
    }

    if (isObject(originalValue) && isObject(partialValue)) {
      const nestedChanges = filterChanges(partialValue as DeepPartial<typeof originalValue>, originalValue);
      if (Object.keys(nestedChanges).length > 0) {
        changes[key] = nestedChanges as T[Extract<keyof T, string>];
      }
    } else if (!deepCompare(originalValue, partialValue)) {
      changes[key] = partialValue as T[Extract<keyof T, string>];
    }
  }

  return changes;
}
