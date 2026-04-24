import type { CLISharedFlags } from '../../types/index.js';

let activeCLIFlags: CLISharedFlags = createDefaultCLISharedFlags();

export function createDefaultCLISharedFlags(): CLISharedFlags {
  return {
    json: false,
    verbose: false,
    debug: false,
    yes: false,
    dryRun: false,
    noInput: false,
    refine: false,
    contextOnly: false,
    submit: false,
    configPath: undefined,
    repoPath: undefined,
  };
}

export function getActiveCLIFlags(): CLISharedFlags {
  return activeCLIFlags;
}

export function setActiveCLIFlags(flags: CLISharedFlags): void {
  activeCLIFlags = {
    ...createDefaultCLISharedFlags(),
    ...flags,
    verbose: flags.verbose || flags.debug,
  };
}
