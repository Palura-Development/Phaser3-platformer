// Analytics tracking module for parent summary
// This provides safe, minimal tracking without breaking existing systems

export interface GameAnalytics {
  sessionStart: number;
  wordsAttempted: string[];
  wordsFailed: string[];
  wordsTimedOut: string[];
  doorWordsCorrect: string[];
  doorWordsFailed: string[];
  pronunciationAttempts: number;
  pronunciationSuccess: number;
  deaths: number;
  sessionEnd?: number;
}

export interface LevelProgress {
  hookWordStats: Record<string, { tookLongToForm: boolean }>;
  pronunciationStats: Record<string, { failedFirstAttempt: boolean }>;
}

// Global analytics object
export const analytics: GameAnalytics = {
  sessionStart: Date.now(),
  wordsAttempted: [],
  wordsFailed: [],
  wordsTimedOut: [],
  doorWordsCorrect: [],
  doorWordsFailed: [],
  pronunciationAttempts: 0,
  pronunciationSuccess: 0,
  deaths: 0,
};

// Per-level summary data (reset each level start/restart)
export const levelProgress: LevelProgress = {
  hookWordStats: {},
  pronunciationStats: {},
};

const pronunciationWordState: Record<string, { hadFailure: boolean; succeeded: boolean }> = {};

function normalizeWord(word: string): string {
  return word.trim().toUpperCase();
}

export function resetLevelProgress() {
  analytics.sessionStart = Date.now();
  analytics.wordsAttempted = [];
  analytics.wordsFailed = [];
  analytics.wordsTimedOut = [];
  analytics.doorWordsCorrect = [];
  analytics.doorWordsFailed = [];
  analytics.pronunciationAttempts = 0;
  analytics.pronunciationSuccess = 0;
  analytics.deaths = 0;
  analytics.sessionEnd = undefined;

  levelProgress.hookWordStats = {};
  levelProgress.pronunciationStats = {};

  Object.keys(pronunciationWordState).forEach((k) => delete pronunciationWordState[k]);
}

export function trackPronunciationWordResult(word: string, success: boolean) {
  const key = normalizeWord(word);
  const state = pronunciationWordState[key] ?? { hadFailure: false, succeeded: false };

  if (success) {
    state.succeeded = true;
  } else if (!state.succeeded) {
    state.hadFailure = true;
  }

  pronunciationWordState[key] = state;

  if (state.succeeded) {
    levelProgress.pronunciationStats[key] = {
      failedFirstAttempt: state.hadFailure,
    };
  }
}

// Safe tracking functions that can be called from anywhere
export function trackWordAttempt(word: string) {
  if (!analytics.wordsAttempted.includes(word)) {
    analytics.wordsAttempted.push(word);
  }

  const key = normalizeWord(word);
  if (!levelProgress.hookWordStats[key]) {
    levelProgress.hookWordStats[key] = { tookLongToForm: false };
  }
}

export function trackWordFailure(word: string) {
  if (!analytics.wordsFailed.includes(word)) {
    analytics.wordsFailed.push(word);
  }
}

export function trackPronunciationAttempt(success: boolean) {
  analytics.pronunciationAttempts++;
  if (success) {
    analytics.pronunciationSuccess++;
  }
}

export function trackWordTimeout(word: string) {
  if (!analytics.wordsTimedOut.includes(word)) {
    analytics.wordsTimedOut.push(word);
  }

  const key = normalizeWord(word);
  levelProgress.hookWordStats[key] = { tookLongToForm: true };
}

export function trackDoorWordResult(word: string, correct: boolean) {
  trackPronunciationWordResult(word, correct);

  if (correct) {
    if (!analytics.doorWordsCorrect.includes(word)) {
      analytics.doorWordsCorrect.push(word);
    }
  } else {
    if (!analytics.doorWordsFailed.includes(word)) {
      analytics.doorWordsFailed.push(word);
    }
  }
}

export function trackDeath() {
  analytics.deaths++;
}

export function endSession() {
  analytics.sessionEnd = Date.now();
}

// Generate mock data for demo purposes if real tracking isn't available
export function generateMockDataIfNeeded() {
  // If no real data was tracked, populate with demo values
  if (analytics.wordsAttempted.length === 0) {
    analytics.wordsAttempted = [
      'flame', 'frost', 'storm', 'shadow', 'light',
      'thunder', 'wind', 'earth', 'water', 'fire',
      'crystal', 'dragon', 'wizard', 'magic', 'spell'
    ];
  }

  if (analytics.wordsFailed.length === 0) {
    analytics.wordsFailed = ['thunder', 'crystal', 'wizard'];
  }

  if (analytics.pronunciationAttempts === 0) {
    analytics.pronunciationAttempts = 18;
    analytics.pronunciationSuccess = 15;
  }

  if (analytics.wordsTimedOut.length === 0) {
    analytics.wordsTimedOut = ['storm'];
  }

  if (analytics.doorWordsCorrect.length === 0) {
    analytics.doorWordsCorrect = ['blaze', 'frost', 'blind'];
  }

  if (analytics.doorWordsFailed.length === 0) {
    analytics.doorWordsFailed = ['storm'];
  }
}
