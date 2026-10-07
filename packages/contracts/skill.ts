export type SkillSettings = { enabled: boolean; autoApprove: boolean };
export type SkillFileRecord = { path: string; bytes: number };
export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  enabled: boolean;
  pending?: boolean;
  files?: SkillFileRecord[];
  body?: string;
};
export type SkillContext = {
  settings: SkillSettings;
  skills: SkillRecord[];
  pending: SkillRecord[];
  indexSection: string;
  toolHint: string;
};

export type SkillFileReadResult = { path: string; bytes: number; text: string; chars: number; offset: number; truncated: boolean; binary: boolean };
export type GithubSkillArchive = {
  roots: readonly string[];
  candidates: readonly { key: string; name?: string }[];
  document: string;
  files: readonly { path: string; text?: string; base64?: string }[];
};

export type SkillCapabilityPorts = {
  maxCalls: number;
  maxInstalls: number;
  searchSkills: (query: unknown, skills: readonly SkillRecord[], limit: number) => readonly SkillRecord[];
  readSkill: (id: unknown, options?: { pending?: boolean }) => SkillRecord | null;
  readSkillFile: (id: string, path: string, options?: { pending?: boolean; offset?: number }) => SkillFileReadResult | null;
  recordSkillUsage: (id: string, options?: { pending?: boolean }) => void;
  buildSkillToolContent: (skill: SkillRecord, file: SkillFileReadResult | null, offset: number) => string;
  installSkill: (input: Record<string, unknown>) => SkillRecord | null;
  installSkillFromDocument: (input: Record<string, unknown>) => SkillRecord | null;
  fetchSkillText: (source: string, options: { signal: AbortSignal }) => Promise<{ text: string; url: string }>;
  parseGithubSkillTarget: (source: string) => { owner: string; repo: string; ref?: string; dir?: string } | null;
  fetchSkillFilesFromGithub: (target: { owner: string; repo: string; ref?: string; dir?: string }, options: { signal: AbortSignal }) => Promise<GithubSkillArchive>;
};
