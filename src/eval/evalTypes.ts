export interface Assertion {
  type: string;
  value?: string;
  values?: string[];
  field?: string;
  expected?: boolean;
  description: string;
}

export interface Scenario {
  id: string;
  description: string;
  session: {
    mode: string;
    continuity_scope: string;
    continuity_family: string;
    writeback_policy?: string;
  };
  messages?: Array<{ role: string; content: string }>;
  primed_memories?: unknown[];
  input_draft?: string;
  assertions: Assertion[];
}

export interface ScenariosFile {
  version: string;
  description?: string;
  scenarios: Scenario[];
}
