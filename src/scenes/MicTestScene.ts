import Phaser from 'phaser';

export default class MicTestScene extends Phaser.Scene {
  private microphoneReady = false;
  private speechRecognition?: any;
  private isListening = false;
  private testPassed = false;
  private testWords = ['HELLO', 'TEST', 'MAGIC', 'READY'];
  private currentTestWord = '';
  private testAttempts = 0;
  private maxAttempts = 3;
  
  // UI Elements
  private titleText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private instructionText!: Phaser.GameObjects.Text;
  private testWordText!: Phaser.GameObjects.Text;
  private startButton!: Phaser.GameObjects.Rectangle;
  private startButtonText!: Phaser.GameObjects.Text;
  private skipButton!: Phaser.GameObjects.Rectangle;
  private skipButtonText!: Phaser.GameObjects.Text;
  private continueButton!: Phaser.GameObjects.Rectangle;
  private continueButtonText!: Phaser.GameObjects.Text;
  private micIcon!: Phaser.GameObjects.Graphics;

  constructor() {
    super('MicTestScene');
  }

  create() {
    // Create background
    this.add.rectangle(400, 300, 800, 600, 0x1a1a2e).setDepth(0);
    
    // Create title
    this.titleText = this.add.text(400, 80, '🎤 MICROPHONE TEST', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#60a5fa',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);

    // Create status text
    this.statusText = this.add.text(400, 140, 'Let\'s test your microphone for voice spells!', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
      wordWrap: { width: 600 },
      align: 'center'
    }).setOrigin(0.5).setDepth(10);

    // Create instruction text
    this.instructionText = this.add.text(400, 200, 'Click "Start Test" to begin microphone setup', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#9ca3af',
      stroke: '#000000',
      strokeThickness: 2,
      wordWrap: { width: 600 },
      align: 'center'
    }).setOrigin(0.5).setDepth(10);

    // Create test word display (initially hidden)
    this.testWordText = this.add.text(400, 280, '', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#fbbf24',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10).setVisible(false);

    // Create microphone icon
    this.createMicrophoneIcon();

    // Create buttons
    this.createButtons();

    // Setup initial state
    this.updateUI('initial');
  }

  private createMicrophoneIcon() {
    this.micIcon = this.add.graphics().setDepth(10);
    this.drawMicrophoneIcon(0x6b7280); // Gray initially
  }

  private drawMicrophoneIcon(color: number) {
    this.micIcon.clear();
    this.micIcon.setPosition(400, 350);
    
    // Microphone body
    this.micIcon.fillStyle(color);
    this.micIcon.fillRoundedRect(-15, -25, 30, 40, 15);
    
    // Microphone stand
    this.micIcon.lineStyle(4, color);
    this.micIcon.beginPath();
    this.micIcon.moveTo(0, 15);
    this.micIcon.lineTo(0, 35);
    this.micIcon.moveTo(-20, 35);
    this.micIcon.lineTo(20, 35);
    this.micIcon.strokePath();
    
    // Sound waves (when active)
    if (this.isListening) {
      this.micIcon.lineStyle(2, 0x22c55e);
      for (let i = 1; i <= 3; i++) {
        this.micIcon.strokeCircle(0, -5, 20 + i * 10);
      }
    }
  }

  private createButtons() {
    // Start Test Button
    this.startButton = this.add.rectangle(300, 450, 160, 50, 0x22c55e)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.startMicrophoneTest())
      .on('pointerover', () => this.startButton.setFillStyle(0x16a34a))
      .on('pointerout', () => this.startButton.setFillStyle(0x22c55e));

    this.startButtonText = this.add.text(300, 450, 'START TEST', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // Skip Button
    this.skipButton = this.add.rectangle(500, 450, 160, 50, 0x6b7280)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.skipTest())
      .on('pointerover', () => this.skipButton.setFillStyle(0x4b5563))
      .on('pointerout', () => this.skipButton.setFillStyle(0x6b7280));

    this.skipButtonText = this.add.text(500, 450, 'SKIP TEST', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11);

    // Continue Button (initially hidden)
    this.continueButton = this.add.rectangle(400, 520, 200, 50, 0x3b82f6)
      .setDepth(10)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.continueToGame())
      .on('pointerover', () => this.continueButton.setFillStyle(0x2563eb))
      .on('pointerout', () => this.continueButton.setFillStyle(0x3b82f6));

    this.continueButtonText = this.add.text(400, 520, 'CONTINUE TO GAME', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(11).setVisible(false);
  }

  private async startMicrophoneTest() {
    this.updateUI('requesting_permission');
    
    try {
      // Request microphone permission
      await this.requestMicrophonePermission();
      await this.setupSpeechRecognition();
      
      if (this.microphoneReady) {
        this.beginVoiceTest();
      }
    } catch (error) {
      console.error('Microphone test failed:', error);
      this.updateUI('permission_denied');
    }
  }

  private async requestMicrophonePermission(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      console.log('🎤 Microphone permission granted');
      return Promise.resolve();
    } catch (error) {
      console.error('🎤 Microphone permission error:', error);
      throw error;
    }
  }

  private async setupSpeechRecognition(): Promise<void> {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      throw new Error('Speech recognition not supported');
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toUpperCase().trim();
      console.log(`🎤 Test heard: "${transcript}"`);
      this.handleTestResult(transcript);
    };

    this.speechRecognition.onerror = (event: any) => {
      console.log('🎤 Speech recognition error:', event.error);
      this.isListening = false;
      this.drawMicrophoneIcon(0xef4444);
      
      if (event.error === 'not-allowed') {
        this.updateUI('permission_denied');
      } else if (event.error === 'no-speech') {
        this.updateUI('no_speech');
      } else {
        this.updateUI('error');
      }
    };

    this.speechRecognition.onstart = () => {
      console.log('🎤 Test speech recognition started');
      this.isListening = true;
      this.drawMicrophoneIcon(0x22c55e);
    };

    this.speechRecognition.onend = () => {
      console.log('🎤 Test speech recognition ended');
      this.isListening = false;
      this.drawMicrophoneIcon(0x6b7280);
    };

    this.microphoneReady = true;
  }

  private beginVoiceTest() {
    this.currentTestWord = this.testWords[Math.floor(Math.random() * this.testWords.length)];
    this.testAttempts = 0;
    this.updateUI('testing');
    this.startListening();
  }

  private startListening() {
    if (!this.speechRecognition || this.isListening) return;

    try {
      this.speechRecognition.start();
      this.updateUI('listening');
      
      // Auto-stop after 5 seconds
      this.time.delayedCall(5000, () => {
        if (this.isListening) {
          this.speechRecognition.stop();
        }
      });
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      this.updateUI('error');
    }
  }

  private handleTestResult(transcript: string) {
    this.isListening = false;
    
    if (transcript === this.currentTestWord) {
      // Test passed!
      this.testPassed = true;
      this.updateUI('test_passed');
      this.drawMicrophoneIcon(0x22c55e);
    } else {
      // Test failed, try again
      this.testAttempts++;
      if (this.testAttempts >= this.maxAttempts) {
        this.updateUI('test_failed');
        this.drawMicrophoneIcon(0xef4444);
      } else {
        this.updateUI('try_again');
        this.time.delayedCall(2000, () => {
          if (!this.testPassed) {
            this.startListening();
          }
        });
      }
    }
  }

  private updateUI(state: string) {
    switch (state) {
      case 'initial':
        this.statusText.setText('Let\'s test your microphone for voice spells!');
        this.instructionText.setText('Click "Start Test" to begin microphone setup');
        this.startButton.setVisible(true);
        this.startButtonText.setVisible(true);
        this.skipButton.setVisible(true);
        this.skipButtonText.setVisible(true);
        break;

      case 'requesting_permission':
        this.statusText.setText('Requesting microphone permission...');
        this.instructionText.setText('Please allow microphone access when prompted');
        this.startButton.setVisible(false);
        this.startButtonText.setVisible(false);
        break;

      case 'permission_denied':
        this.statusText.setText('❌ Microphone access denied');
        this.instructionText.setText('Voice spells will be disabled. You can still play with keyboard controls.');
        this.skipButton.setVisible(true);
        this.skipButtonText.setVisible(true);
        this.skipButtonText.setText('CONTINUE');
        break;

      case 'testing':
        this.statusText.setText('🎤 Microphone ready! Let\'s test it.');
        this.instructionText.setText(`Say the word below clearly when the microphone is listening:`);
        this.testWordText.setText(this.currentTestWord).setVisible(true);
        this.startButton.setVisible(false);
        this.startButtonText.setVisible(false);
        break;

      case 'listening':
        this.statusText.setText('🎤 LISTENING... Speak now!');
        this.instructionText.setText(`Say: "${this.currentTestWord}"`);
        break;

      case 'no_speech':
        this.statusText.setText('🎤 No speech detected. Try again!');
        this.instructionText.setText('Speak louder and clearer');
        this.time.delayedCall(2000, () => {
          if (!this.testPassed) {
            this.startListening();
          }
        });
        break;

      case 'try_again':
        this.statusText.setText(`❌ Heard something else. Try again! (${this.testAttempts}/${this.maxAttempts})`);
        this.instructionText.setText(`Say: "${this.currentTestWord}" clearly`);
        break;

      case 'test_passed':
        this.statusText.setText('✅ Microphone test passed!');
        this.instructionText.setText('Voice spells are ready! You can cast spells by saying completed words.');
        this.testWordText.setVisible(false);
        this.showContinueButton();
        break;

      case 'test_failed':
        this.statusText.setText('❌ Microphone test failed');
        this.instructionText.setText('Voice spells will be disabled. You can still play with keyboard controls.');
        this.testWordText.setVisible(false);
        this.showContinueButton();
        break;

      case 'error':
        this.statusText.setText('❌ Microphone error occurred');
        this.instructionText.setText('There was a problem with your microphone. You can still play without voice.');
        this.testWordText.setVisible(false);
        this.showContinueButton();
        break;
    }
  }

  private showContinueButton() {
    this.continueButton.setVisible(true);
    this.continueButtonText.setVisible(true);
    this.skipButton.setVisible(false);
    this.skipButtonText.setVisible(false);
    
    // Animate button appearance
    this.continueButton.setScale(0);
    this.continueButtonText.setScale(0);
    this.tweens.add({
      targets: [this.continueButton, this.continueButtonText],
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });
  }

  private skipTest() {
    console.log('🎤 Microphone test skipped');
    this.continueToGame();
  }

  private continueToGame() {
    // Pass test results to the game
    const micTestResults = {
      microphoneReady: this.testPassed,
      speechRecognition: this.testPassed ? this.speechRecognition : null
    };
    
    console.log('🎮 Starting game with microphone status:', this.testPassed ? 'ENABLED' : 'DISABLED');
    
    // Start the game scene with microphone test results
    this.scene.start('GameScene', micTestResults);
  }
}






