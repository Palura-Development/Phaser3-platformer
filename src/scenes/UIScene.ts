import Phaser from 'phaser';

export default class UIScene extends Phaser.Scene {
  constructor() {
    super('UIScene');
  }

  create(data: { word?: string; isComplete?: boolean } = {}) {
    const isLevelComplete = data.word === 'LEVEL COMPLETE' || data.isComplete;
    
    const displayText = isLevelComplete
      ? '🎉 YOU DID IT! 🎉\nLEVEL COMPLETE!'
      : data.word
      ? `WORD COMPLETE!\n${data.word}`
      : 'WORD COMPLETE!';

    const label = this.add
      .text(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        displayText,
        {
          fontFamily: 'monospace',
          fontSize: isLevelComplete ? '48px' : '42px',
          align: 'center',
          color: isLevelComplete ? '#ffd700' : '#ffffff',
          stroke: '#000000',
          strokeThickness: 6,
        }
      )
      .setOrigin(0.5);

    // Fade in animation
    label.setAlpha(0);
    this.tweens.add({
      targets: label,
      alpha: 1,
      duration: 400,
      ease: 'Sine.easeOut',
    });

    // If level complete, keep it displayed longer and don't resume
    if (isLevelComplete) {
      // Add restart hint
      const hintText = this.add
        .text(
          this.cameras.main.centerX,
          this.cameras.main.centerY + 80,
          'Click to restart',
          {
            fontFamily: 'monospace',
            fontSize: '20px',
            color: '#aaaaaa',
          }
        )
        .setOrigin(0.5)
        .setAlpha(0);

      this.tweens.add({
        targets: hintText,
        alpha: 1,
        duration: 800,
        delay: 1000,
        ease: 'Sine.easeIn',
      });

      // Restart on click
      this.input.once('pointerdown', () => {
        this.scene.stop('UIScene');
        this.scene.stop('GameScene');
        this.scene.start('GameScene');
      });

      return;
    }

    // Normal word completion - fade out and resume
    this.tweens.add({
      targets: label,
      alpha: 0,
      duration: 1600,
      delay: 800,
      ease: 'Sine.easeIn',
      onComplete: () => {
        this.scene.stop('UIScene');
        this.scene.resume('GameScene');
      },
    });
  }
}

