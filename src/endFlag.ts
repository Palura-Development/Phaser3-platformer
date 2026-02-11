// End-of-level flag module
// Handles flag creation, trigger detection, and level ending

import Phaser from 'phaser';
import { showParentSummary } from './parentSummaryOverlay';
import { endSession, generateMockDataIfNeeded } from './analytics';

export interface EndFlag {
  sprite?: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  width: number;
  height: number;
  triggered: boolean;
}

// Flag configuration - placed at end of level
export const endFlagConfig: EndFlag = {
  x: 8650, // Where final hook zone used to be
  y: 400,
  width: 32,
  height: 64,
  triggered: false,
};

// Create the visual flag in the scene
export function createEndFlag(scene: Phaser.Scene): void {
  // Create a visible flag using a rectangle for now
  // You can replace this with an actual flag sprite later
  const flag = scene.add.rectangle(
    endFlagConfig.x,
    endFlagConfig.y,
    endFlagConfig.width,
    endFlagConfig.height,
    0xffaa00 // Orange/gold color
  );

  flag.setStrokeStyle(3, 0xffff00); // Yellow border
  flag.setDepth(10); // Ensure it's visible above ground

  // Add a pole
  const pole = scene.add.rectangle(
    endFlagConfig.x - 12,
    endFlagConfig.y + 32,
    4,
    96,
    0x654321 // Brown color
  );
  pole.setDepth(10);

  endFlagConfig.sprite = flag;

  console.log('End flag created at:', endFlagConfig.x, endFlagConfig.y);
}

// AABB rectangle overlap detection
function rectsOverlap(a: { x: number; y: number; width: number; height: number },
                      b: { x: number; y: number; width: number; height: number }): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// Check if player has triggered the flag
export function checkEndFlagTrigger(
  player: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
  scene: Phaser.Scene
): void {
  // Only check once
  if (endFlagConfig.triggered) return;

  // Get player bounds
  const playerRect = {
    x: player.x - player.displayWidth / 2,
    y: player.y - player.displayHeight / 2,
    width: player.displayWidth,
    height: player.displayHeight,
  };

  // Get flag bounds
  const flagRect = {
    x: endFlagConfig.x - endFlagConfig.width / 2,
    y: endFlagConfig.y - endFlagConfig.height / 2,
    width: endFlagConfig.width,
    height: endFlagConfig.height,
  };

  // Check overlap
  if (rectsOverlap(playerRect, flagRect)) {
    console.log('Flag triggered! Ending level...');
    endFlagConfig.triggered = true;
    endLevel(scene);
  }
}

// End the level and show parent summary
function endLevel(scene: Phaser.Scene): void {
  // Pause the game
  (window as any).__GAME_PAUSED__ = true;

  // Stop player movement
  if (scene.scene.isActive('GameScene')) {
    const gameScene = scene.scene.get('GameScene') as any;
    if (gameScene.player) {
      gameScene.player.setVelocity(0, 0);
    }
  }

  // End analytics session
  endSession();

  // Generate mock data if needed
  generateMockDataIfNeeded();

  // Show parent summary overlay
  setTimeout(() => {
    showParentSummary();
  }, 300); // Small delay for smooth transition
}

// Reset the flag (for play again)
export function resetEndFlag(): void {
  endFlagConfig.triggered = false;
  (window as any).__GAME_PAUSED__ = false;
}
