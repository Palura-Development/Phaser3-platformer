// Parent Summary Overlay Module
// Read-only level completion summary shown after entering the open final door

import { levelProgress } from './analytics';

let overlayCreated = false;

export function createParentOverlay(): void {
  if (overlayCreated) return;

  const overlay = document.createElement('div');
  overlay.id = 'parent-overlay';
  overlay.className = 'parent-overlay hidden';
  overlay.innerHTML = `
    <div class="overlay-card">
      <div class="pixel-banner">
        <span class="pixel-trophy">T</span>
        <h1>LEVEL COMPLETE</h1>
        <span class="pixel-trophy">T</span>
      </div>
      <p class="subtitle">Progress Summary</p>

      <section class="dashboard-section" id="parent-positive-section">
        <h2>Great Job!</h2>
        <div id="parent-positive-message"></div>
      </section>

      <section class="struggles-section" id="parent-word-formation-section">
        <h2>WORD BUILDING</h2>
        <div id="parent-word-formation"></div>
      </section>

      <section class="pronunciation-section" id="parent-pronunciation-section">
        <h2>PRONUNCIATION</h2>
        <div id="parent-pronunciation"></div>
      </section>

      <section class="recommendations-section" id="parent-insight-section">
        <h2>PARENT INSIGHT</h2>
        <div id="parent-insight"></div>
      </section>

      <button id="parent-continue" class="play-again-btn">CONTINUE TO NEXT LEVEL</button>
    </div>
  `;

  document.body.appendChild(overlay);
  overlayCreated = true;

  const continueBtn = document.getElementById('parent-continue');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      const params = new URLSearchParams(window.location.search);
      const currentLevel = Number(params.get('level') ?? '1');
      const nextLevel = Number.isFinite(currentLevel) && currentLevel > 0 ? currentLevel + 1 : 2;
      params.set('level', String(nextLevel));
      window.location.href = `${window.location.pathname}?${params.toString()}`;
    });
  }
}

export function showParentSummary(): void {
  if (!overlayCreated) {
    createParentOverlay();
  }

  populatePositive();
  populateWordFormation();
  populatePronunciation();
  populateParentInsight();

  const overlay = document.getElementById('parent-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
  }
}

function populatePositive(): void {
  const positive = document.getElementById('parent-positive-message');
  if (!positive) return;

  positive.innerHTML = `
    <p style="margin:0 0 8px 0;">Great job!</p>
    <p style="margin:0 0 8px 0;">You are ready for the next level.</p>
  `;
}

function populateWordFormation(): void {
  const section = document.getElementById('parent-word-formation-section');
  const container = document.getElementById('parent-word-formation');
  if (!section || !container) return;

  const uniqueTimedOutWords = Object.entries(levelProgress.hookWordStats)
    .filter(([, stat]) => stat.tookLongToForm)
    .map(([word]) => word);

  if (uniqueTimedOutWords.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  container.innerHTML = `
    <p style="margin:0 0 8px 0;">Words that took longer to form:</p>
    <p style="margin:0; font-weight:bold;">${uniqueTimedOutWords.join(', ')}</p>
  `;
}

function populatePronunciation(): void {
  const section = document.getElementById('parent-pronunciation-section');
  const container = document.getElementById('parent-pronunciation');
  if (!section || !container) return;

  const uniqueHarderWords = Object.entries(levelProgress.pronunciationStats)
    .filter(([, stat]) => stat.failedFirstAttempt)
    .map(([word]) => word);

  if (uniqueHarderWords.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  container.innerHTML = `
    <p style="margin:0 0 8px 0;">Words that required multiple attempts to pronounce:</p>
    <p style="margin:0; font-weight:bold;">${uniqueHarderWords.join(', ')}</p>
  `;
}

function populateParentInsight(): void {
  const insight = document.getElementById('parent-insight');
  if (!insight) return;

  insight.innerHTML = `
    <p style="margin:0;">
      Taking longer to build words may indicate unfamiliar letter patterns.
      Practicing reading aloud and phonics-based games can help strengthen these skills.
    </p>
  `;
}
