import { isObject } from './is-object';

export function deepCompare(
  obj1: unknown,
  obj2: unknown,
  { allowMissingAsUndefined = false }: { allowMissingAsUndefined?: boolean } = {},
): boolean {
  if (obj1 === obj2) {
    return true;
  }
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    return arraysEqual(obj1, obj2, allowMissingAsUndefined);
  }
  if (isObject(obj1) && isObject(obj2)) {
    return objectsEqual(obj1, obj2, allowMissingAsUndefined);
  }

  return false;
}

function arraysEqual(arr1: unknown[], arr2: unknown[], allowMissingAsUndefined: boolean): boolean {
  if (arr1.length !== arr2.length) {
    return false;
  }
  return arr1.every((item, index) => deepCompare(item, arr2[index], { allowMissingAsUndefined }));
}

function objectsEqual(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>,
  allowMissingAsUndefined: boolean,
): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  // Collect all unique keys from both objects
  const allKeys = new Set([...keys1, ...keys2]);

  for (const key of allKeys) {
    const val1 = obj1[key];
    const val2 = obj2[key];
    const keyInObj1 = key in obj1;
    const keyInObj2 = key in obj2;

    // When allowing missing keys as undefined, check if one of the values is undefined
    // and the key is not present in the other object, then continue
    if (allowMissingAsUndefined && (!keyInObj1 || !keyInObj2)) {
      // If key is not present in either object, continue if one of the values is undefined
      if ((val1 === undefined && !keyInObj2) || (val2 === undefined && !keyInObj1)) {
        continue;
      } else {
        // If the key is missing in one object but the other has a non-undefined value, return false
        return false;
      }
    }

    // For cases where both keys are present or allowMissingAsUndefined is not applied,
    // perform a deep comparison
    if (!deepCompare(val1, val2, { allowMissingAsUndefined })) {
      return false;
    }
  }

  return true;
}
