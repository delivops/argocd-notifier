import { operatorResources } from '@/operator-resources';

export const getPluralKind = (kind: string): string => {
  const pluralName = operatorResources.find((r) => r.crdConfig.names.kind === kind)?.crdConfig.names.kindPlural;

  if (!pluralName) {
    throw new Error(`No plural name found for ${kind}`);
  }

  return pluralName;
};
