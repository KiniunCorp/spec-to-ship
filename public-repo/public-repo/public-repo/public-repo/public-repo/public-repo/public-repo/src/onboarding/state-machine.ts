export type OnboardingState =
  | 'UNINITIALIZED_NO_GIT'
  | 'UNINITIALIZED_GIT_ROOT'
  | 'UNINITIALIZED_GIT_SUBDIR'
  | 'INITIALIZED_HEALTHY'
  | 'INITIALIZED_WITH_CONFLICTS'
  | 'INITIALIZED_UPDATE_PENDING_SOFT'
  | 'INITIALIZED_UPDATE_PENDING_HARD';

export function classifyOnboardingState(input: {
  initialized: boolean;
  hasGitRepository: boolean;
  isGitSubdirectory: boolean;
  hasConflicts: boolean;
  updateMode: 'none' | 'soft' | 'hard';
}): OnboardingState {
  if (!input.initialized) {
    if (!input.hasGitRepository) return 'UNINITIALIZED_NO_GIT';
    return input.isGitSubdirectory ? 'UNINITIALIZED_GIT_SUBDIR' : 'UNINITIALIZED_GIT_ROOT';
  }

  if (input.updateMode === 'hard') return 'INITIALIZED_UPDATE_PENDING_HARD';
  if (input.updateMode === 'soft') return 'INITIALIZED_UPDATE_PENDING_SOFT';
  if (input.hasConflicts) return 'INITIALIZED_WITH_CONFLICTS';
  return 'INITIALIZED_HEALTHY';
}

