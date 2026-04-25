import path from 'node:path';
import { getActiveCLIFlags } from '../io/state.js';
import { commandMeta, failCLI, printJson } from '../io/output.js';
import {
  COMPLETION_SHELLS,
  PUBLIC_HELP_TOPICS,
  SHOW_SUBJECTS,
  SUPPORTED_STAGES,
  type CompletionShell,
} from '../types.js';

export function handleCompletionCommand(args: string[]): void {
  const usage = 'Usage: s2s completion [bash|zsh|fish]\nHelp: s2s help completion';
  if (args.length > 1) {
    failCLI(usage, { usage: 's2s completion [bash|zsh|fish]' });
  }

  const explicitShell = args[0] ? String(args[0]).trim() : '';
  const requestedShell = explicitShell ? normalizeCompletionShell(explicitShell) : detectCompletionShellFromEnvironment();
  if (explicitShell && !requestedShell) {
    failCLI(`Unsupported completion shell: ${explicitShell}\n${usage}`);
  }
  if (!requestedShell) {
    failCLI(`Could not determine which shell completion to print.\n${usage}`);
  }

  const script = renderCompletionScript(requestedShell);
  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('completion', { shell: requestedShell }),
      shell: requestedShell,
      script,
    });
    return;
  }
  console.log(script);
}

export function normalizeCompletionShell(value: string): CompletionShell | undefined {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (COMPLETION_SHELLS.includes(normalized as CompletionShell)) {
    return normalized as CompletionShell;
  }
  return undefined;
}

export function detectCompletionShellFromEnvironment(): CompletionShell | undefined {
  return normalizeCompletionShell(path.basename(String(process.env.SHELL || '').trim()));
}

export function renderCompletionScript(shell: CompletionShell): string {
  switch (shell) {
    case 'bash':
      return renderBashCompletionScript();
    case 'zsh':
      return renderZshCompletionScript();
    case 'fish':
      return renderFishCompletionScript();
  }
}

function renderBashCompletionScript(): string {
  const commands = [
    'help', 'version', 'list', 'update', 'init', 'config', 'stage', 'status', 'show',
    'approve', 'reject', 'worktrees', 'completion', 'doctor', 'backup', 'restore', 'remove',
  ].join(' ');
  const helpTopics = PUBLIC_HELP_TOPICS.join(' ');
  const stages = SUPPORTED_STAGES.join(' ');
  const showSubjects = SHOW_SUBJECTS.join(' ');
  const shells = COMPLETION_SHELLS.join(' ');

  return [
    '# bash completion for s2s',
    '_s2s() {',
    '  local cur prev command',
    '  COMPREPLY=()',
    '  cur="${COMP_WORDS[COMP_CWORD]}"',
    '  prev="${COMP_WORDS[COMP_CWORD-1]}"',
    '  command="${COMP_WORDS[1]}"',
    '',
    `  local commands="${commands}"`,
    `  local help_topics="${helpTopics}"`,
    `  local stages="${stages}"`,
    `  local show_subjects="${showSubjects}"`,
    `  local shells="${shells}"`,
    '  local global_flags="--json --dry-run --yes -y --no-input --verbose --debug --repo --config --help -h --version -v"',
    '',
    '  if [[ ${COMP_CWORD} -eq 1 ]]; then',
    '    COMPREPLY=( $(compgen -W "$commands $global_flags" -- "$cur") )',
    '    return 0',
    '  fi',
    '',
    '  case "$command" in',
    '    help)',
    '      COMPREPLY=( $(compgen -W "$help_topics" -- "$cur") )',
    '      return 0',
    '      ;;',
    '    stage)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "$stages" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    config)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "edit" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    show)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "$show_subjects" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    worktrees)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "list" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    completion)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "$shells" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    restore)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "--latest --snapshot=" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '    remove)',
    '      if [[ ${COMP_CWORD} -eq 2 ]]; then',
    '        COMPREPLY=( $(compgen -W "--keep-backups" -- "$cur") )',
    '        return 0',
    '      fi',
    '      ;;',
    '  esac',
    '',
    '  if [[ "$cur" == --* || "$cur" == -* ]]; then',
    '    COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )',
    '  fi',
    '}',
    'complete -F _s2s s2s',
  ].join('\n');
}

function renderZshCompletionScript(): string {
  const commands = [
    'help:Show command help', 'version:Print CLI version', 'list:List configured projects',
    'update:Refresh project-managed files', 'init:Initialize or repair managed state',
    'config:Show or edit project config', 'stage:Run a stage pipeline', 'status:Show execution status',
    'show:Inspect change/spec/slice state', 'approve:Approve a gate decision', 'reject:Reject a gate decision',
    'worktrees:Inspect managed worktrees', 'completion:Print shell completion script',
    'doctor:Validate managed project health', 'backup:Create a managed backup',
    'restore:Restore a managed backup', 'remove:Remove s2s artifacts',
  ].map((entry) => `'${entry}'`).join(' ');
  const helpTopics = PUBLIC_HELP_TOPICS.map((topic) => `'${topic}:${topic}'`).join(' ');
  const stages = SUPPORTED_STAGES.map((stage) => `'${stage}:${stage}'`).join(' ');
  const showSubjects = SHOW_SUBJECTS.map((subject) => `'${subject}:${subject}'`).join(' ');
  const shells = COMPLETION_SHELLS.map((shell) => `'${shell}:${shell}'`).join(' ');

  return [
    '#compdef s2s',
    '',
    'local -a commands help_topics stages show_subjects shells global_flags',
    `commands=(${commands})`,
    `help_topics=(${helpTopics})`,
    `stages=(${stages})`,
    `show_subjects=(${showSubjects})`,
    `shells=(${shells})`,
    'global_flags=(',
    "  '--json:Emit machine-readable output when supported'",
    "  '--dry-run:Preview intended actions without side effects'",
    "  '--yes:Skip confirmation prompts'",
    "  '-y:Skip confirmation prompts'",
    "  '--no-input:Disable prompts and fail if input is required'",
    "  '--verbose:Show additional operational context'",
    "  '--debug:Show diagnostic context'",
    "  '--repo:Resolve command context from an explicit repository path'",
    "  '--config:Record an explicit runtime-config override path'",
    '  )',
    '',
    'if (( CURRENT == 2 )); then',
    "  _describe 'command' commands",
    '  return 0',
    'fi',
    '',
    'case "$words[2]" in',
    '  help)',
    "    _describe 'help topic' help_topics",
    '    ;;',
    '  stage)',
    "    _describe 'stage' stages",
    '    ;;',
    '  config)',
    "    _describe 'config command' 'edit:Edit project config interactively'",
    '    ;;',
    '  show)',
    "    _describe 'show subject' show_subjects",
    '    ;;',
    '  worktrees)',
    "    _describe 'worktrees command' 'list:List managed worktrees'",
    '    ;;',
    '  completion)',
    "    _describe 'shell' shells",
    '    ;;',
    '  restore)',
    "    _describe 'restore option' '--latest:Restore the latest snapshot' '--snapshot=:Restore one snapshot id'",
    '    ;;',
    '  remove)',
    "    _describe 'remove option' '--keep-backups:Preserve global backups'",
    '    ;;',
    '  *)',
    "    _describe 'global flag' global_flags",
    '    ;;',
    'esac',
  ].join('\n');
}

function renderFishCompletionScript(): string {
  return [
    '# fish completion for s2s',
    'complete -c s2s -f',
    "complete -c s2s -n '__fish_use_subcommand' -a 'help version list update init config stage status show approve reject worktrees completion doctor backup restore remove'",
    "complete -c s2s -n '__fish_seen_subcommand_from help' -a 'start version list update init config stage status show approve reject worktrees completion doctor backup restore remove project-resolution'",
    "complete -c s2s -n '__fish_seen_subcommand_from stage' -a 'pm research design engineering engineering_exec'",
    "complete -c s2s -n '__fish_seen_subcommand_from config' -a 'edit'",
    "complete -c s2s -n '__fish_seen_subcommand_from show' -a 'change spec slices blockers dependencies'",
    "complete -c s2s -n '__fish_seen_subcommand_from worktrees' -a 'list'",
    "complete -c s2s -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish'",
    "complete -c s2s -n '__fish_seen_subcommand_from restore' -l latest -d 'Restore latest snapshot'",
    "complete -c s2s -n '__fish_seen_subcommand_from restore' -l snapshot -r -d 'Restore one snapshot id'",
    "complete -c s2s -n '__fish_seen_subcommand_from remove' -l keep-backups -d 'Preserve global backups'",
    "complete -c s2s -l json -d 'Emit machine-readable output when supported'",
    "complete -c s2s -l dry-run -d 'Preview intended actions without side effects'",
    "complete -c s2s -s y -l yes -d 'Skip confirmation prompts'",
    "complete -c s2s -l no-input -d 'Disable prompts and fail if input is required'",
    "complete -c s2s -l verbose -d 'Show additional operational context'",
    "complete -c s2s -l debug -d 'Show diagnostic context'",
    "complete -c s2s -l repo -r -d 'Resolve command context from an explicit repository path'",
    "complete -c s2s -l config -r -d 'Record an explicit runtime-config override path'",
  ].join('\n');
}
