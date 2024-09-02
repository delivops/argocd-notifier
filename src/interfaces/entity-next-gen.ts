export type EntityNextGen = {
  metadata: { name: string };
  spec: object;
  status: object & { observedGeneration?: number };
};
