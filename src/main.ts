import Phaser from 'phaser';
import MicTestScene from './scenes/MicTestScene';
import GameScene from './scenes/GameScene';
import UIScene from './scenes/UIScene';
import './style.css';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  backgroundColor: '#0f0f23',
  pixelArt: true,
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { x: 0, y: 900 },
      debug: false,
    },
  },
  scene: [MicTestScene, GameScene, UIScene],
};

window.addEventListener('DOMContentLoaded', () => {
  const game = new Phaser.Game(config);
  // Start with the microphone test scene
  game.scene.start('MicTestScene');
});
