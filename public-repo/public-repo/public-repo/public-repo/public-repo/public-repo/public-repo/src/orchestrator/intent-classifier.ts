import type { IntentClassification, WorkIntent } from '../types/index.js';

type IntentSignal = {
  pattern: RegExp;
  weight: number;
  label: string;
};

type IntentRule = {
  intent: WorkIntent;
  signals: IntentSignal[];
};

const intentPriority: WorkIntent[] = [
  'hotfix',
  'resume_existing_change',
  'spec_revision',
  'incident_investigation',
  'bug_fix',
  'technical_refactor',
  'implementation_only',
  'feature_refinement',
  'new_feature',
];

const intentRules: IntentRule[] = [
  {
    intent: 'hotfix',
    signals: [
      { pattern: /\bhotfix\b/, weight: 4, label: 'hotfix' },
      { pattern: /\burgent\s+(fix|patch)\b/, weight: 3, label: 'urgent fix' },
      { pattern: /\bemergency\s+(fix|patch)\b/, weight: 3, label: 'emergency patch' },
      { pattern: /\bsev(?:erity)?[-\s]?(1|one)\b/, weight: 3, label: 'sev1' },
      { pattern: /\bproduction\s+(issue|outage|incident|break(age)?)\b/, weight: 2, label: 'production issue' },
    ],
  },
  {
    intent: 'resume_existing_change',
    signals: [
      { pattern: /\bresume\b/, weight: 4, label: 'resume' },
      { pattern: /\bcontinue\b/, weight: 4, label: 'continue' },
      { pattern: /\bpick\s+up\b/, weight: 4, label: 'pick up' },
      { pattern: /\bcarry\s+on\b/, weight: 3, label: 'carry on' },
      { pattern: /\bfinish\b/, weight: 2, label: 'finish existing work' },
      { pattern: /\b(existing|current|open)\s+(change|work|spec|slice)\b/, weight: 3, label: 'existing work reference' },
      { pattern: /\b(change|spec|slice|run)-[a-z0-9][a-z0-9-]*\b/, weight: 3, label: 'operational id reference' },
    ],
  },
  {
    intent: 'spec_revision',
    signals: [
      { pattern: /\b(update|revise|rewrite|edit|clarify|adjust)\s+(the\s+)?(spec|requirements|acceptance criteria)\b/, weight: 4, label: 'revise spec' },
      { pattern: /\b(change|update)\s+the\s+plan\b/, weight: 3, label: 'update plan' },
      { pattern: /\b(spec|prd|design doc)\b/, weight: 2, label: 'spec artifact reference' },
      { pattern: /\bacceptance criteria\b/, weight: 2, label: 'acceptance criteria' },
      { pattern: /\brequirements?\b/, weight: 2, label: 'requirements' },
    ],
  },
  {
    intent: 'incident_investigation',
    signals: [
      { pattern: /\binvestigat(?:e|ion)\b/, weight: 4, label: 'investigate' },
      { pattern: /\broot cause\b/, weight: 4, label: 'root cause' },
      { pattern: /\brca\b/, weight: 3, label: 'rca' },
      { pattern: /\bincident\b/, weight: 3, label: 'incident' },
      { pattern: /\boutage\b/, weight: 3, label: 'outage' },
      { pattern: /\bwhy did\b/, weight: 2, label: 'why did' },
      { pattern: /\bwhat happened\b/, weight: 2, label: 'what happened' },
    ],
  },
  {
    intent: 'bug_fix',
    signals: [
      { pattern: /\bbug\b/, weight: 4, label: 'bug' },
      { pattern: /\bfix\b/, weight: 3, label: 'fix' },
      { pattern: /\berror\b/, weight: 3, label: 'error' },
      { pattern: /\bissue\b/, weight: 2, label: 'issue' },
      { pattern: /\bregression\b/, weight: 3, label: 'regression' },
      { pattern: /\bbroken\b/, weight: 2, label: 'broken' },
      { pattern: /\bnot working\b/, weight: 2, label: 'not working' },
    ],
  },
  {
    intent: 'technical_refactor',
    signals: [
      { pattern: /\brefactor\b/, weight: 4, label: 'refactor' },
      { pattern: /\bclean\s*up\b/, weight: 3, label: 'clean up' },
      { pattern: /\btech(?:nical)?\s+debt\b/, weight: 3, label: 'tech debt' },
      { pattern: /\brestructure\b/, weight: 3, label: 'restructure' },
      { pattern: /\brename\b/, weight: 2, label: 'rename' },
      { pattern: /\bextract\b/, weight: 2, label: 'extract' },
      { pattern: /\bmaintainability\b/, weight: 2, label: 'maintainability' },
      { pattern: /\bmoderniz(?:e|ation)\b/, weight: 2, label: 'modernize' },
    ],
  },
  {
    intent: 'implementation_only',
    // Only match when the user *explicitly* signals they already have a plan and
    // want to skip planning stages. Generic construction verbs (build, code, ship)
    // must NOT appear here — they fire on new-project requests and cause the
    // classifier to skip PM/design for brand-new work.
    signals: [
      { pattern: /\bimplement\b/, weight: 3, label: 'implement' },
      { pattern: /\bskip\b.{0,20}\b(spec|planning|design|research)\b/, weight: 4, label: 'skip planning' },
      { pattern: /\b(no|without)\s+(spec|planning|design|research)\b/, weight: 4, label: 'without planning' },
      { pattern: /\bjust\s+(implement|build|code|ship)\b/, weight: 4, label: 'just implement' },
      { pattern: /\bbased\s+on\s+(the\s+)?(spec|prd|design|plan|backlog)\b/, weight: 4, label: 'based on existing spec' },
      { pattern: /\bspec\s+(is\s+)?ready\b/, weight: 4, label: 'spec ready' },
      { pattern: /\bplan\s+(is\s+)?approved\b/, weight: 4, label: 'plan approved' },
    ],
  },
  {
    intent: 'feature_refinement',
    signals: [
      { pattern: /\bimprov(?:e|ement)\b/, weight: 3, label: 'improve' },
      { pattern: /\brefin(?:e|ement)\b/, weight: 4, label: 'refine' },
      { pattern: /\bpolish\b/, weight: 3, label: 'polish' },
      { pattern: /\benhanc(?:e|ement)\b/, weight: 3, label: 'enhance' },
      { pattern: /\bextend\b/, weight: 2, label: 'extend' },
      { pattern: /\btweak\b/, weight: 2, label: 'tweak' },
      { pattern: /\bexisting\s+feature\b/, weight: 3, label: 'existing feature' },
    ],
  },
  {
    intent: 'new_feature',
    signals: [
      { pattern: /\bnew\s+feature\b/, weight: 4, label: 'new feature' },
      { pattern: /\badd\b/, weight: 2, label: 'add' },
      { pattern: /\bintroduce\b/, weight: 2, label: 'introduce' },
      { pattern: /\bcreate\b/, weight: 2, label: 'create' },
      { pattern: /\bsupport\b/, weight: 2, label: 'support' },
      { pattern: /\bfrom\s+scratch\b/, weight: 3, label: 'from scratch' },
      { pattern: /\bcapability\b/, weight: 2, label: 'capability' },
      // Generic construction verbs without "just/skip/without" context = new work
      { pattern: /\bbuild\b/, weight: 2, label: 'build' },
      { pattern: /\bmake\b/, weight: 1, label: 'make' },
      { pattern: /\blets?\s+(build|create|make|start)\b/, weight: 2, label: 'lets build' },
      { pattern: /\b(new|a)\s+(app|site|website|service|page|tool|dashboard|api|cli|platform)\b/, weight: 3, label: 'new product artifact' },
      { pattern: /\bwant\s+(a|an|to\s+build|to\s+create)\b/, weight: 2, label: 'want a thing' },
    ],
  },
];

type IntentScore = {
  score: number;
  matchedSignals: string[];
};

function normalizeRequest(request: string): string {
  return String(request || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreIntent(request: string, rule: IntentRule): IntentScore {
  const matchedSignals: string[] = [];
  let score = 0;

  for (const signal of rule.signals) {
    if (!signal.pattern.test(request)) {
      continue;
    }

    score += signal.weight;
    matchedSignals.push(signal.label);
  }

  return {
    score,
    matchedSignals,
  };
}

function compareIntentScores(
  left: { intent: WorkIntent; score: number },
  right: { intent: WorkIntent; score: number },
): number {
  return (
    right.score - left.score ||
    intentPriority.indexOf(left.intent) - intentPriority.indexOf(right.intent)
  );
}

function buildConfidence(score: number): number {
  if (score <= 0) {
    return 0.4;
  }

  return Math.min(0.55 + score * 0.05, 0.95);
}

export function classifyIntent(request: string): IntentClassification {
  const normalizedRequest = normalizeRequest(request);
  const scoredIntents = intentRules.map((rule) => {
    const result = scoreIntent(normalizedRequest, rule);
    return {
      intent: rule.intent,
      score: result.score,
      matchedSignals: result.matchedSignals,
    };
  });

  scoredIntents.sort(compareIntentScores);
  const winner = scoredIntents[0];

  if (!winner || winner.score <= 0) {
    return {
      intent: 'new_feature',
      confidence: 0.4,
      rationale: 'No explicit intent signals matched; defaulting to new_feature.',
      matchedSignals: [],
    };
  }

  return {
    intent: winner.intent,
    confidence: buildConfidence(winner.score),
    rationale: `Matched ${winner.intent} signals: ${winner.matchedSignals.join(', ')}.`,
    matchedSignals: winner.matchedSignals,
  };
}
