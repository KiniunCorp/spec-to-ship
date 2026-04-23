import { readFileSync, readSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { getActiveCLIFlags } from './state.js';
import { failCLI } from './output.js';

let scriptedPromptAnswers: string[] | null = null;
let scriptedPromptInputLoaded = false;
let scriptedPromptInputAvailable = false;
export const SCRIPTED_PROMPT_INPUT_EXHAUSTED = Symbol('SCRIPTED_PROMPT_INPUT_EXHAUSTED');

export function hasInteractivePromptTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function ensureScriptedPromptAnswersLoaded(): void {
  if (process.stdin.isTTY || scriptedPromptInputLoaded) return;
  const raw = readFileSync(0, 'utf8');
  scriptedPromptAnswers = raw ? raw.split(/\r?\n/) : [];
  scriptedPromptInputAvailable = raw.length > 0;
  scriptedPromptInputLoaded = true;
}

export function canPromptForMissingInput(): boolean {
  if (hasInteractivePromptTerminal()) return true;
  ensureScriptedPromptAnswersLoaded();
  return scriptedPromptInputAvailable;
}

export function failMissingPromptInput(requirement: string): never {
  failCLI(
    `${requirement}\n` +
    'No interactive terminal detected and no scripted stdin answers were available.\n' +
    'Re-run in an interactive terminal, pipe answers on stdin, or use the explicit flag-based equivalent when available.',
  );
}

export function consumeScriptedPromptAnswer(): string | typeof SCRIPTED_PROMPT_INPUT_EXHAUSTED | null {
  if (process.stdin.isTTY) return null;
  ensureScriptedPromptAnswersLoaded();
  if (!scriptedPromptInputAvailable) return null;
  if (!scriptedPromptAnswers || scriptedPromptAnswers.length === 0) {
    return SCRIPTED_PROMPT_INPUT_EXHAUSTED;
  }
  return scriptedPromptAnswers.shift() ?? '';
}

export function resolveEnumeratedAnswer(
  value: string,
  options: readonly string[],
  defaultValue: string,
): string {
  if (!value) return defaultValue;
  const optionNumber = Number(value);
  if (Number.isInteger(optionNumber) && optionNumber >= 1 && optionNumber <= options.length) {
    return options[optionNumber - 1];
  }
  const normalized = options.find((option) => option.toLowerCase() === value.toLowerCase());
  return normalized || value;
}

export function parsePositiveIntInput(value: string, fallback: number): number {
  const parsed = Number(String(value || '').trim());
  if (!Number.isFinite(parsed)) return Math.max(1, Math.floor(fallback));
  if (parsed <= 0) return Math.max(1, Math.floor(fallback));
  return Math.max(1, Math.floor(parsed));
}

export function parseBooleanInput(value: string, fallback: boolean): boolean {
  const v = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

export function askWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  if (getActiveCLIFlags().noInput) {
    failCLI(`Prompt disabled by --no-input.\nRequired interactive input: ${label}`);
  }
  const scripted = consumeScriptedPromptAnswer();
  if (scripted === SCRIPTED_PROMPT_INPUT_EXHAUSTED) {
    failMissingPromptInput(`Required interactive input: ${label}`);
  }
  if (scripted !== null) return Promise.resolve(String(scripted || defaultValue).trim());
  if (!hasInteractivePromptTerminal()) {
    failMissingPromptInput(`Required interactive input: ${label}`);
  }
  return rl.question(`${label} [${defaultValue}]: `).then((answer) => String(answer || defaultValue).trim());
}

export function askEnumeratedOption(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options: readonly string[],
  defaultValue: string,
): Promise<string> {
  if (getActiveCLIFlags().noInput) {
    failCLI(`Prompt disabled by --no-input.\nRequired interactive selection: ${label}`);
  }
  const defaultIndex = Math.max(0, options.findIndex((option) => option === defaultValue));
  const scripted = consumeScriptedPromptAnswer();
  if (scripted === SCRIPTED_PROMPT_INPUT_EXHAUSTED) {
    failMissingPromptInput(`Required interactive selection: ${label}`);
  }
  if (scripted !== null) {
    return Promise.resolve(resolveEnumeratedAnswer(scripted, options, defaultValue));
  }
  if (!hasInteractivePromptTerminal()) {
    failMissingPromptInput(`Required interactive selection: ${label}`);
  }
  console.log(`${label}:`);
  for (const [index, option] of options.entries()) {
    console.log(`  ${index + 1}) ${option}`);
  }
  return rl
    .question(`Select option [${defaultIndex + 1}]: `)
    .then((answer) => resolveEnumeratedAnswer(String(answer || '').trim(), options, defaultValue));
}

export function askPrompt(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string> {
  if (getActiveCLIFlags().noInput) {
    failCLI(`Prompt disabled by --no-input.\nRequired interactive prompt: ${prompt}`);
  }
  const scripted = consumeScriptedPromptAnswer();
  if (scripted === SCRIPTED_PROMPT_INPUT_EXHAUSTED) {
    failMissingPromptInput(`Required interactive prompt: ${prompt}`);
  }
  if (scripted !== null) return Promise.resolve(String(scripted).trim());
  if (!hasInteractivePromptTerminal()) {
    failMissingPromptInput(`Required interactive prompt: ${prompt}`);
  }
  return rl.question(prompt).then((answer) => String(answer || '').trim());
}

export async function promptYesNoInteractive(message: string, defaultYes: boolean): Promise<boolean> {
  const flags = getActiveCLIFlags();
  if (flags.yes) return true;
  if (flags.noInput) {
    failCLI(`Prompt disabled by --no-input.\nConfirmation required: ${message}`);
  }
  const scripted = consumeScriptedPromptAnswer();
  if (scripted === SCRIPTED_PROMPT_INPUT_EXHAUSTED) {
    failMissingPromptInput(`Confirmation required: ${message}`);
  }
  if (scripted !== null) {
    const normalized = String(scripted || '').trim().toLowerCase();
    if (!normalized) return defaultYes;
    return normalized === 'y' || normalized === 'yes';
  }
  if (!hasInteractivePromptTerminal()) {
    failMissingPromptInput(`Confirmation required: ${message}`);
  }
  const rl = createInterface({ input, output });
  try {
    const suffix = defaultYes ? '[Y/n]' : '[y/N]';
    const answer = await rl.question(`${message} ${suffix}: `);
    const normalized = String(answer || '').trim().toLowerCase();
    if (!normalized) return defaultYes;
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

export function promptYesNoSync(message: string, defaultYes: boolean): boolean {
  const flags = getActiveCLIFlags();
  if (flags.yes) return true;
  if (flags.noInput) {
    failCLI(`Prompt disabled by --no-input.\nConfirmation required: ${message}`);
  }
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  process.stdout.write(`${message}${suffix}`);
  const answer = readLineFromStdinSync();
  const normalized = String(answer.line || '').trim().toLowerCase();
  if (answer.resourceUnavailable && !normalized) {
    process.stdout.write('\n');
    return false;
  }
  if (!normalized) return defaultYes;
  return normalized === 'y' || normalized === 'yes';
}

export function readLineFromStdinSync(): { line: string; resourceUnavailable: boolean } {
  const buffer = Buffer.alloc(1);
  let line = '';
  let resourceUnavailable = false;
  while (true) {
    let bytes = 0;
    try {
      bytes = readSync(0, buffer, 0, 1, null);
    } catch (error) {
      if (isTemporaryReadError(error)) {
        resourceUnavailable = true;
        break;
      }
      throw error;
    }
    if (bytes <= 0) break;
    const ch = buffer.toString('utf8', 0, bytes);
    if (ch === '\n' || ch === '\r') break;
    line += ch;
  }
  return { line, resourceUnavailable };
}

function isTemporaryReadError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '');
  return code === 'EAGAIN' || code === 'EWOULDBLOCK';
}

export async function confirmStateChangingCommand(options: {
  action: string;
  noInputMessage: string;
  canceledMessage: string;
  defaultYes?: boolean;
}): Promise<void> {
  const flags = getActiveCLIFlags();
  if (flags.yes) return;
  if (flags.noInput) {
    failCLI(`Prompt disabled by --no-input.\n${options.noInputMessage}`);
  }
  if (!canPromptForMissingInput()) {
    failCLI(options.noInputMessage);
  }
  const confirmed = await promptYesNoInteractive(options.action, Boolean(options.defaultYes));
  if (!confirmed) {
    failCLI(options.canceledMessage);
  }
}

/**
 * Confirmation gate for human-only commands (approve, reject).
 * Unlike confirmStateChangingCommand, this intentionally ignores --yes.
 * These commands require a human at the terminal — they must not be
 * callable programmatically by an AI agent or automated script.
 */
export async function confirmHumanApprovalCommand(options: {
  action: string;
  canceledMessage: string;
}): Promise<void> {
  const flags = getActiveCLIFlags();
  if (flags.noInput) {
    failCLI(
      `Prompt disabled by --no-input.\n` +
      `s2s approve and s2s reject are human-only commands — they cannot be called programmatically.`,
    );
  }
  // Scripted stdin answers are accepted (for testing), but --yes is not.
  const scripted = consumeScriptedPromptAnswer();
  if (scripted === SCRIPTED_PROMPT_INPUT_EXHAUSTED) {
    failCLI(`s2s approve and s2s reject require interactive confirmation.`);
  }
  if (scripted !== null) {
    const normalized = String(scripted || '').trim().toLowerCase();
    const confirmed = normalized === 'y' || normalized === 'yes';
    if (!confirmed) failCLI(options.canceledMessage);
    return;
  }
  if (!hasInteractivePromptTerminal()) {
    failCLI(
      `This command requires an interactive terminal.\n` +
      `s2s approve and s2s reject are human-only — they cannot be called programmatically.`,
    );
  }
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${options.action} [y/N]: `);
    const normalized = String(answer || '').trim().toLowerCase();
    if (normalized !== 'y' && normalized !== 'yes') failCLI(options.canceledMessage);
  } finally {
    rl.close();
  }
}
