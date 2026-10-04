export type AgentJsonOutput = {
  kind: 'json';
  body: Record<string, unknown>;
  status?: number;
};

export type AgentStreamOutput = {
  kind: 'stream';
  body: ReadableStream<Uint8Array>;
  status?: number;
  headers?: Record<string, string>;
};

export type AgentApplicationOutput = AgentJsonOutput | AgentStreamOutput;

export function applicationJson(body: Record<string, unknown>, options?: { status?: number }): AgentJsonOutput {
  return { kind: 'json', body, ...(options?.status === undefined ? {} : { status: options.status }) };
}

export function applicationStream(body: ReadableStream<Uint8Array>, headers?: Record<string, string>, status?: number): AgentStreamOutput {
  return { kind: 'stream', body, ...(headers ? { headers } : {}), ...(status === undefined ? {} : { status }) };
}
