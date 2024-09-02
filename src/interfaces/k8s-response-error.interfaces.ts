// Sync with API

export type K8sResponseError = Error & {
  body: string & {
    apiVersion?: string | 'v1';
    code?: number;
    details?: object | { name: string; group: string; kind: string }; // { name: 'aaa'; group: 'vops.ai'; kind: 'clients'; };
    kind?: string | 'Status';
    message?: string; // 'clients.vops.ai "aaa" already exists'
    metadata?: object; // {}
    reason?: string; // Http error code names like 'NotFound', 'AlreadyExists';
    status?: string | 'Failure';
  };
  name: string | 'HttpError';
  response: object;
  statusCode: number;
  message: string; // Error.message "HTTP request failed"
  stack: string; // Error.stack
};
