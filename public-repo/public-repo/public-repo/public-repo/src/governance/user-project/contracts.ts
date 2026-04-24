export interface UserProjectGovernanceRenderContext {
  appRoot: string;
}

export interface UserProjectGovernanceBundle {
  guardrails: {
    agents: string;
    codex: string;
    claude: string;
  };
  rootBlocks: {
    agents: string;
    codex: string;
    claude: string;
  };
}
