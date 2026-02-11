import Phaser from 'phaser';
import { createParentOverlay, showParentSummary } from '../parentSummaryOverlay';
import { createNodePlacements, type Platform, type LetterNode } from '../letterNodes';
import {
  endSession,
  resetLevelProgress,
  trackDoorWordResult,
  trackPronunciationAttempt,
  trackPronunciationWordResult,
  trackWordAttempt,
  trackWordFailure,
  trackWordTimeout
} from '../analytics';

const AUTO_MOVE_THRESHOLD = 10;
const PLAYER_MAX_VELOCITY_X = 250;
const PLAYER_ACCELERATION = 900;
const PLAYER_DRAG = 1400;
const PLAYER_JUMP_VELOCITY = -460; // Increased jump height
const PLAYER_JUMP_SUSTAIN = -350;
const COYOTE_TIME = 100;

export default class GameScene extends Phaser.Scene {
  private map!: Phaser.Tilemaps.Tilemap;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private platformLayer!: Phaser.Tilemaps.TilemapLayer;
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasdKeys?: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private jumpKey?: Phaser.Input.Keyboard.Key;
  private attackKey?: Phaser.Input.Keyboard.Key;
  private spawnPoint!: Phaser.Math.Vector2;
  private checkpointReached = false;
  private checkpointPosition!: Phaser.Math.Vector2;
  private checkpointFlag?: Phaser.GameObjects.Image;
  private firstLetterCollected = false;
  private hazardGroup!: Phaser.Physics.Arcade.StaticGroup;
  private movingHazards: {
    shape: Phaser.GameObjects.Rectangle;
    glow?: Phaser.GameObjects.Rectangle;
    body: Phaser.Physics.Arcade.Body;
    axis: 'x' | 'y';
    min: number;
    max: number;
    speed: number;
  }[] = [];
  
  // Combat system
  private demons: {
    sprite: Phaser.GameObjects.Image;
    body: Phaser.Physics.Arcade.Body;
    health: number;
    chaseSpeed: number;
    attackCooldown: number;
    isStunned: boolean;
    stunDuration: number;
  }[] = [];
  private magicProjectiles: Phaser.GameObjects.Image[] = [];
  private isAttacking = false;
  private attackCooldown = 0;

  // New Combat System
  private enemies: {
    sprite: Phaser.GameObjects.Image;
    body: Phaser.Physics.Arcade.Body;
    hp: number;
    maxHp: number;
    patrolMin: number;
    patrolMax: number;
    speed: number;
    isDead: boolean;
    enemyType: 'basic' | 'snow' | 'fire';
    snowballCooldown: number;
    canBeDamagedBy?: string[];
    fireState?: 'ACTIVE' | 'FROZEN' | 'DEAD';
    fireBeam?: Phaser.GameObjects.Graphics;
    fireBeamTargetX?: number;
    fireBeamTargetY?: number;
    fireBeamTickCooldown?: number;
    frozenUntil?: number;
  }[] = [];
  private projectiles: Phaser.GameObjects.Image[] = [];
  private snowballs: Phaser.GameObjects.Image[] = [];
  private playerHasBlazeSpell = false;
  private snowDemonsSpawned = false;
  private playerHasFrostSpell = false;
  private fireDemonsSpawned = false;
  private playerSlowMovementMultiplier = 1;
  private playerSlowTimer?: Phaser.Time.TimerEvent;
  private fireBeamBurnMeter = 0;
  private fireBeamBurnDecayTimer?: Phaser.Time.TimerEvent;
  private combatKeys: {
    melee: Phaser.Input.Keyboard.Key;
    dash: Phaser.Input.Keyboard.Key;
    projectile: Phaser.Input.Keyboard.Key;
    flare: Phaser.Input.Keyboard.Key;
    frost: Phaser.Input.Keyboard.Key;
    storm: Phaser.Input.Keyboard.Key;
    blind: Phaser.Input.Keyboard.Key;
    hungry: Phaser.Input.Keyboard.Key;
    fastTraversal: Phaser.Input.Keyboard.Key;
  } = {} as any;
  private combatCooldowns = {
    melee: 0,
    dash: 0,
    projectile: 0,
    flare: 0,
    frost: 0,
    storm: 0,
    blind: 0,
    hungry: 0,
  };
  private isDashing = false;
  private dashDuration = 0;
  private familiar?: Phaser.GameObjects.Image;
  private familiarActive = false;
  private familiarDuration = 0;
  
  // Death/respawn system
  private lives = 3;
  private isInvulnerable = false;
  
  // Weapon system
  private weaponMode: 'wand' | 'sword' = 'wand';
  private isBarraging = false;
  private barrageCount = 0;
  private waitingForFrostPronunciation = false;

  // Jumuf Companion System
  private jumuf?: Phaser.GameObjects.Image;
  private staticGenieNpc?: Phaser.GameObjects.Image;
  private jumufBobbingTween?: Phaser.Tweens.Tween;
  private jumufVisible = false; // Start invisible, will appear at beginning then disappear
  private jumufHintBubble?: Phaser.GameObjects.Container;
  private traversalMistakes = 0;
  private pronunciationMistakes = 0;
  private deaths = 0;
  private lastFailedSpell?: string;
  private diedDuringSpell = false;

  private letters: Phaser.GameObjects.Text[] = [];
  private nodeCircles: Phaser.GameObjects.Arc[] = []; // Circular node backgrounds
  private manualControlEnabled = true;
  private isTraversing = false;
  private activeTraversalTween?: Phaser.Tweens.Tween;

  private coyoteTimer = 0;
  private hasJumped = false;
  private jumpSustain = false;
  private jumpTime = 0;

  // Word system
  private wordList = ['BLAZE', 'FROST', 'STORM', 'BLIND', 'HUNGRY'];
  private currentWordIndex = 0;
  private currentLetterIndex = 0;
  private currentWord = '';
  private isTransitioningWords = false;
  private collectedLetters: string[] = []; // Track all collected letters
  
  // UI Word System
  private incompleteWords: { word: string; missingLetters: string[]; foundLetters: string[] }[] = [];
  private wordUIContainer?: Phaser.GameObjects.Container;
  private completedSpellWords: string[] = []; // Words available for voice attacks

  // Hook Zone UI System - UNIVERSAL (word-agnostic)
  private isInHookZone = false;
  private currentHookZoneIndex = -1;
  private hookZoneTargetWord = '';
  private hookZoneCollectedLetters: string[] = [];  // Letters collected (for tracking)
  private hookZoneSlotState: boolean[] = [];        // Slot-based tracking: true = filled
  private hookZoneFilledLetters: string[] = [];     // Actual letters in each slot (for display)
  private hookZoneUI?: Phaser.GameObjects.Container;
  private hookZoneHintGiven: boolean[] = [false, false, false, false, false];
  private hookZoneSolved: boolean[] = [false, false, false, false, false]; // Track completed zones
  private hookZoneExitBlocked = false;              // True while zone is incomplete
  private hookZoneFirstLetterPreCollected: boolean[] = [false, false, false, false, false]; // Track first letters hooked from outside
  private hookZoneWordTimer?: Phaser.Time.TimerEvent; // 15s timer for word solving timeout
  private hookZoneEntryRespawnPoint?: { zoneIndex: number; x: number; y: number };
  // Hook zones expanded to 700px (800px for HUNGRY with 6 letters) for better node spacing
  private hookZoneDefinitions = [
    { start: 700, end: 1400, word: 'BLAZE', hint: 'Something fiery, burning fiercely...' },      // 700px
    { start: 2050, end: 2750, word: 'FROST', hint: 'Cold and icy, like winter morning dew...' }, // 700px
    { start: 3400, end: 4100, word: 'STORM', hint: 'A disturbance of weather with thunder and clouds...' }, // 700px
    { start: 4750, end: 5450, word: 'BLIND', hint: 'Unable to see, lost in darkness...' },      // 700px
    { start: 6500, end: 7300, word: 'HUNGRY', hint: 'A feeling when you need food...' },        // 800px (6 letters)
  ];

  // Voice recognition system
  private completedWords: string[] = [];
  private speechRecognition?: any;
  private isListening = false;
  private voiceKey?: Phaser.Input.Keyboard.Key;
  private testKey?: Phaser.Input.Keyboard.Key;
  private doorKey?: Phaser.Input.Keyboard.Key;
  private releaseHookKey?: Phaser.Input.Keyboard.Key; // P key to release hook and drop
  private microphoneReady = false;
  
  // Gemini STT for pronunciation detection
  private mediaRecorder?: MediaRecorder;
  private audioChunks: Blob[] = [];
  private isRecordingPronunciation = false;
  private hungryUnlocked = false;

  constructor() {
    super('GameScene');
  }

  init(data: { microphoneReady?: boolean; speechRecognition?: any } = {}) {
    // Receive microphone test results
    this.microphoneReady = data.microphoneReady || false;
    
    // Create combat textures
    this.createMagicBoltTexture();
    this.createCheckpointFlagTexture();
    this.speechRecognition = data.speechRecognition || null;
    
    console.log('🎮 GameScene initialized with microphone status:', this.microphoneReady ? 'ENABLED' : 'DISABLED');
  }

  preload() {
    this.load.tilemapTiledJSON('level1', '/data/level1.json');
    this.load.image('tileset', '/assets/tiles/tileset.png');
    
    // Load dungeon door sprite (if available)
    this.load.image('dungeon_door', '/assets/dungeon_door.png');

    // Create cave background
    this.createCaveBackground();

    if (!this.textures.exists('mage')) {
      // Create a pixel art mage sprite
      const g = this.add.graphics();
      
      // Mage body (purple robe)
      g.fillStyle(0x6b46c1, 1);
      g.fillRect(6, 16, 12, 12);
      
      // Mage head (skin tone)
      g.fillStyle(0xfdbcb4, 1);
      g.fillRect(8, 8, 8, 8);
      
      // Mage hat (dark purple)
      g.fillStyle(0x4c1d95, 1);
      g.fillRect(7, 4, 10, 6);
      g.fillRect(9, 2, 6, 4);
      
      // Hat tip (yellow star)
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(11, 1, 2, 2);
      
      // Eyes (black dots)
      g.fillStyle(0x000000, 1);
      g.fillRect(9, 10, 1, 1);
      g.fillRect(14, 10, 1, 1);
      
      // Beard (white)
      g.fillStyle(0xffffff, 1);
      g.fillRect(8, 13, 8, 3);
      
      // Staff (brown)
      g.fillStyle(0x92400e, 1);
      g.fillRect(18, 8, 2, 16);
      
      // Staff orb (cyan)
      g.fillStyle(0x06b6d4, 1);
      g.fillRect(17, 6, 4, 4);
      
      // Robe trim (gold)
      g.fillStyle(0xf59e0b, 1);
      g.fillRect(6, 26, 12, 2);
      
      g.generateTexture('mage', 24, 28);
      g.destroy();
    }

    if (!this.textures.exists('dust')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(2, 2, 2);
      g.generateTexture('dust', 4, 4);
      g.destroy();
    }
  }

  private createCaveBackground() {
    // Create cave wall texture
    if (!this.textures.exists('cave_wall')) {
      const g = this.add.graphics();
      
      // Dark cave wall base
      g.fillStyle(0x1a1a1a, 1);
      g.fillRect(0, 0, 64, 64);
      
      // Rock texture details
      g.fillStyle(0x2d2d2d, 1);
      g.fillRect(4, 8, 12, 6);
      g.fillRect(20, 15, 8, 4);
      g.fillRect(35, 5, 10, 8);
      g.fillRect(10, 35, 15, 7);
      g.fillRect(40, 40, 12, 8);
      
      // Lighter rock highlights
      g.fillStyle(0x404040, 1);
      g.fillRect(6, 10, 8, 2);
      g.fillRect(22, 16, 4, 2);
      g.fillRect(37, 6, 6, 3);
      g.fillRect(12, 37, 10, 3);
      g.fillRect(42, 42, 8, 4);
      
      // Cave crystals scattered around
      g.fillStyle(0x3b82f6, 1);
      g.fillRect(15, 5, 2, 2);
      g.fillRect(50, 20, 2, 2);
      g.fillRect(8, 50, 2, 2);
      g.fillRect(45, 55, 2, 2);
      
      // Crystal glow
      g.fillStyle(0x60a5fa, 1);
      g.fillRect(16, 6, 1, 1);
      g.fillRect(51, 21, 1, 1);
      g.fillRect(9, 51, 1, 1);
      g.fillRect(46, 56, 1, 1);
      
      g.generateTexture('cave_wall', 64, 64);
      g.destroy();
    }

    // Create stalactite texture
    if (!this.textures.exists('stalactite')) {
      const g = this.add.graphics();
      
      // Stalactite shape (dark gray)
      g.fillStyle(0x374151, 1);
      g.fillRect(6, 0, 4, 16);
      g.fillRect(5, 4, 6, 8);
      g.fillRect(4, 8, 8, 4);
      
      // Highlights
      g.fillStyle(0x4b5563, 1);
      g.fillRect(6, 0, 2, 16);
      g.fillRect(5, 4, 3, 8);
      
      // Shadows
      g.fillStyle(0x1f2937, 1);
      g.fillRect(8, 2, 2, 14);
      g.fillRect(9, 6, 3, 6);
      
      g.generateTexture('stalactite', 16, 16);
      g.destroy();
    }
  }

  create() {
    resetLevelProgress();
    this.playerHasBlazeSpell = false;
    this.snowDemonsSpawned = false;
    this.playerHasFrostSpell = false;
    this.fireDemonsSpawned = false;
    this.playerSlowMovementMultiplier = 1;
    this.fireBeamBurnMeter = 0;
    if (this.fireBeamBurnDecayTimer) {
      this.fireBeamBurnDecayTimer.remove();
      this.fireBeamBurnDecayTimer = undefined;
    }
    this.snowballs = [];
    if (this.playerSlowTimer) {
      this.playerSlowTimer.remove();
      this.playerSlowTimer = undefined;
    }

    this.map = this.make.tilemap({ key: 'level1' });
    const tileset = this.map.addTilesetImage('placeholder-tiles', 'tileset');
    if (!tileset) {
      throw new Error('Tileset missing or mismatched.');
    }

    this.groundLayer = this.map
      .createLayer('ground', tileset, 0, 0)!
      .setDepth(0)
      .setVisible(false);
    this.platformLayer = this.map
      .createLayer('platforms', tileset, 0, 0)!
      .setDepth(1)
      .setVisible(false);

    this.spawnPoint = new Phaser.Math.Vector2(96, this.map.heightInPixels - 96);

    this.player = this.physics.add
      .sprite(this.spawnPoint.x, this.spawnPoint.y, 'mage')
      .setCollideWorldBounds(true)
      .setDepth(5);

    // Create Jumuf companion (genie sprite)
    this.createJumuf();

    this.physics.world.gravity.y = 900;
    this.physics.world.setBounds(
      -200,
      0,
      this.map.widthInPixels + 8000,
      this.map.heightInPixels
    );

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasdKeys = this.input.keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as {
      up: Phaser.Input.Keyboard.Key;
      down: Phaser.Input.Keyboard.Key;
      left: Phaser.Input.Keyboard.Key;
      right: Phaser.Input.Keyboard.Key;
    };
    this.jumpKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.attackKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.voiceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.V);
    this.doorKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.G);

    // Add combat inputs
    this.addCombatInputs();

    // Add test key for checkpoint system (T key)
    this.testKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.T);

    // Add P key to release hook and drop from suspension
    this.releaseHookKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.P);

    // Add Enter key for game over review panel (created ONCE, not in update loop)
    this.gameOverReviewEnterKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    // Setup voice recognition based on mic test results
    this.time.delayedCall(500, () => {
      this.setupVoiceRecognitionFromTest();
    });

    this.hazardGroup = this.physics.add.staticGroup();

    this.cameras.main.setBounds(
      -200,
      0,
      this.map.widthInPixels + 8000,
      this.map.heightInPixels
    );
    this.cameras.main.startFollow(this.player, false, 0.15, 0.15);

    this.buildManualPlatforms();
    this.buildHookZones();  // Create visual hook zone indicators with dense hazards
    this.buildHazards();
    this.physics.add.overlap(this.player, this.hazardGroup, () => this.handleHazardHit(), undefined, this);

    // Add enemies to the level
    this.spawnEnemies();

    // Set checkpoint position (will activate after first word)
    const bandY = this.spawnPoint.y;
    this.checkpointPosition = new Phaser.Math.Vector2(1600, bandY - 100 - 18); // Platform Y position - platform height to spawn on top

    this.createCaveEnvironment();
    this.createStaticGenieNpc();
    this.setupIncompleteWords();
    this.createWordUI();
    this.loadNextWord();

    // Show hook tutorial overlay (10 seconds)
    this.showHookTutorial();

    // Create PronunciationDoor at the end section after HUNGRY
    const doorX = 8500;
    const doorY = this.map.heightInPixels - 96; // Ground-aligned so it blocks player path
    this.pronunciationDoor = new PronunciationDoor(
      this,
      doorX,
      doorY,
      ['Crystal', 'chill', 'bored'],
      (text: string) => this.jumufGiveHint(text),
      () => this.showJumuf()
    );

    // Keep parent overlay bootstrapped; do not trigger progress/end flag in this stage
    createParentOverlay();

  }

  private buildManualPlatforms() {
    const bandY = this.spawnPoint.y - 40;
    const groundY = this.map.heightInPixels - 16;

    // ========== GROUND SEGMENTS (with gaps for hook zones) ==========
    // Hook zones (700px wide, 800px for HUNGRY):
    // Zone 1: 700-1400, Zone 2: 2050-2750, Zone 3: 3400-4100, Zone 4: 4750-5450
    // Zone 5: 6500-7300, Zone 6: 8300-9000
    const groundSegments = [
      { x: 350, y: groundY, width: 700, height: 40 },      // Start to Zone 1 (0-700)
      { x: 1725, y: groundY, width: 650, height: 40 },     // After Z1 to Z2 (1400-2050)
      { x: 3075, y: groundY, width: 650, height: 40 },     // After Z2 to Z3 (2750-3400)
      { x: 4425, y: groundY, width: 650, height: 40 },     // After Z3 to Z4 (4100-4750)
      { x: 5975, y: groundY, width: 1050, height: 40 },    // After Z4 to Z5 (5450-6500)
      { x: 8150, y: groundY, width: 1700, height: 40 },    // After Z5 to level end (7300-9000)
    ];

    // Build ground segments
    groundSegments.forEach((seg) => this.addPlatformBlock(seg.x, seg.y, seg.width, seg.height));

    const defs = [

      // ========== SIMPLE MARIO-STYLE PLATFORMER LAYOUT ==========
      // Platforms above ground for variety and letter node placement

      // Starting area - ground level platforms
      { x: 150, y: bandY, width: 200, height: 18 },
      { x: 400, y: bandY - 60, width: 150, height: 18 },
      { x: 600, y: bandY - 100, width: 160, height: 18 },

      // Early section - stepping stones
      { x: 850, y: bandY - 50, width: 180, height: 18 },
      { x: 1050, y: bandY - 100, width: 150, height: 18 },
      { x: 1250, y: bandY - 150, width: 140, height: 18 },

      // Mid-low platforms
      { x: 1450, y: bandY - 80, width: 160, height: 18 },
      { x: 1650, y: bandY - 40, width: 170, height: 18 },
      { x: 1850, y: bandY - 100, width: 150, height: 18 },

      // Climbing section
      { x: 2050, y: bandY - 140, width: 140, height: 18 },
      { x: 2250, y: bandY - 180, width: 160, height: 18 },
      { x: 2450, y: bandY - 120, width: 150, height: 18 },

      // Platform under "T" in FROST hook zone (prevents falling onto spikes)
      { x: 2710, y: bandY - 50, width: 120, height: 18 },

      // Descent
      { x: 2650, y: bandY - 80, width: 180, height: 18 },
      { x: 2850, y: bandY - 40, width: 170, height: 18 },
      { x: 3050, y: bandY - 100, width: 160, height: 18 },

      // Mid-level platforms
      { x: 3250, y: bandY - 60, width: 180, height: 18 },
      { x: 3450, y: bandY - 120, width: 150, height: 18 },
      { x: 3650, y: bandY - 80, width: 170, height: 18 },

      // Varied heights
      { x: 3850, y: bandY - 40, width: 160, height: 18 },
      { x: 4050, y: bandY - 100, width: 150, height: 18 },
      { x: 4250, y: bandY - 150, width: 140, height: 18 },

      // Easy section
      { x: 4450, y: bandY - 60, width: 180, height: 18 },
      { x: 4650, y: bandY - 40, width: 170, height: 18 },
      { x: 4850, y: bandY - 80, width: 160, height: 18 },

      // Extended area platforms
      { x: 5050, y: bandY - 50, width: 180, height: 18 },
      { x: 5250, y: bandY - 100, width: 160, height: 18 },
      { x: 5450, y: bandY - 70, width: 170, height: 18 },

      { x: 5650, y: bandY - 40, width: 180, height: 18 },
      { x: 5850, y: bandY - 90, width: 160, height: 18 },
      { x: 6050, y: bandY - 130, width: 150, height: 18 },

      { x: 6250, y: bandY - 80, width: 170, height: 18 },
      { x: 6450, y: bandY - 50, width: 180, height: 18 },
      { x: 6650, y: bandY - 100, width: 160, height: 18 },

      { x: 6850, y: bandY - 60, width: 170, height: 18 },
      { x: 7050, y: bandY - 40, width: 180, height: 18 },
      { x: 7250, y: bandY - 90, width: 160, height: 18 },
      { x: 7260, y: bandY - 20, width: 130, height: 18 }, // Platform under "Y" in HUNGRY zone

      { x: 7450, y: bandY - 130, width: 150, height: 18 },
      { x: 7650, y: bandY - 80, width: 170, height: 18 },
      { x: 7850, y: bandY - 50, width: 180, height: 18 },

      { x: 8050, y: bandY - 100, width: 160, height: 18 },
      { x: 8250, y: bandY - 60, width: 170, height: 18 },
    ];

    defs.forEach((def) => this.addPlatformBlock(def.x, def.y, def.width, def.height));
  }

  private addPlatformBlock(x: number, y: number, width: number, height: number) {
    // Create pixel art cave platform texture
    if (!this.textures.exists('platform')) {
      const g = this.add.graphics();
      
      // Cave rock base (dark brown/gray)
      g.fillStyle(0x4a4a4a, 1);
      g.fillRect(0, 0, 32, 18);
      
      // Rock highlights (lighter brown)
      g.fillStyle(0x6b6b6b, 1);
      g.fillRect(0, 0, 32, 2);
      g.fillRect(0, 0, 2, 18);
      g.fillRect(2, 2, 4, 1);
      g.fillRect(8, 1, 6, 1);
      g.fillRect(20, 2, 3, 1);
      
      // Rock shadows (very dark)
      g.fillStyle(0x2d2d2d, 1);
      g.fillRect(30, 0, 2, 18);
      g.fillRect(0, 16, 32, 2);
      g.fillRect(28, 2, 2, 14);
      
      // Cave crystals/minerals (blue/purple)
      g.fillStyle(0x3b82f6, 1);
      g.fillRect(6, 1, 1, 1);
      g.fillRect(15, 1, 1, 1);
      g.fillRect(25, 1, 1, 1);
      
      // Crystal glow (light blue)
      g.fillStyle(0x60a5fa, 1);
      g.fillRect(14, 1, 1, 1);
      g.fillRect(26, 1, 1, 1);
      
      g.generateTexture('platform', 32, 18);
      g.destroy();
    }

    // Create tiled platform using the texture
    const tilesX = Math.ceil(width / 32);
    const tilesY = Math.ceil(height / 18);
    
    for (let tx = 0; tx < tilesX; tx++) {
      for (let ty = 0; ty < tilesY; ty++) {
        const tileX = x - width/2 + tx * 32 + 16;
        const tileY = y - height/2 + ty * 18 + 9;
        this.add.image(tileX, tileY, 'platform').setDepth(2);
      }
    }

    // Create invisible physics body
    const rect = this.add.rectangle(x, y, width, height, 0x3fee6b, 0)
      .setOrigin(0.5, 0.5)
      .setDepth(2);
    rect.setData('isPlatform', true); // Mark as platform for demon collision
    this.physics.add.existing(rect, true);
    const body = rect.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(width, height);
    body.updateFromGameObject();
    this.physics.add.collider(this.player, rect);
  }

  // ========== HOOK ZONE SYSTEM ==========
  // Creates visual indicators, dense hazards, and LETTER NODES for hook-mandatory zones
  // Each zone contains letters that form a complete word for traversal
  private buildHookZones() {
    const groundY = this.map.heightInPixels - 16;
    const zoneHeight = 400; // Height of the visual zone indicator (increased for 450px zones)

    // Use the class-level hookZoneDefinitions (450px wide, 500px for HUNGRY)
    // This ensures consistency between zone detection and zone rendering
    this.hookZoneDefinitions.forEach((zone, zoneIndex) => {
      const zoneWidth = zone.end - zone.start;
      const zoneCenterX = zone.start + zoneWidth / 2;
      const letters = zone.word.split('');

      // ===== VISUAL BACKGROUND INDICATOR =====
      // Dark red/purple tinted background to show danger zone
      const background = this.add.rectangle(
        zoneCenterX,
        groundY - zoneHeight / 2,
        zoneWidth,
        zoneHeight,
        0x4a1942,  // Dark magenta/purple color
        0.35       // Semi-transparent
      );
      background.setDepth(0);
      background.setScrollFactor(1);

      // Add glowing border effect
      const borderLeft = this.add.rectangle(
        zone.start,
        groundY - zoneHeight / 2,
        6,
        zoneHeight,
        0xff4444,
        0.7
      );
      borderLeft.setDepth(0);

      const borderRight = this.add.rectangle(
        zone.end,
        groundY - zoneHeight / 2,
        6,
        zoneHeight,
        0xff4444,
        0.7
      );
      borderRight.setDepth(0);

      // Pulsing animation for borders
      this.tweens.add({
        targets: [borderLeft, borderRight],
        alpha: 0.3,
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });

      // ===== "HOOK ZONE" WARNING TEXT with word hint =====
      const warningText = this.add.text(
        zoneCenterX,
        groundY - zoneHeight + 25,
        `⚠ HOOK ZONE: ${zone.hint}`,
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff6666',
          stroke: '#000000',
          strokeThickness: 3,
        }
      );
      warningText.setOrigin(0.5);
      warningText.setDepth(1);
      warningText.setAlpha(0.9);

      // ===== LETTER NODES INSIDE THE ZONE =====
      // Position letters in a traversable zigzag pattern
      const nodeSpacingX = (zoneWidth - 80) / (letters.length - 1);
      const baseY = groundY - 180; // Base height for nodes

      letters.forEach((letter, i) => {
        // Zigzag pattern: alternate high and low positions
        let offsetY = (i % 2 === 0) ? -40 : 40;

        // Special case: Raise the last letter (E) of BLAZE zone higher
        // This makes it easier to traverse and clearly above the platform
        if (zoneIndex === 0 && i === letters.length - 1) {
          offsetY = -100; // Much higher than normal
        }

        const nodeX = zone.start + 40 + (i * nodeSpacingX);
        const nodeY = baseY + offsetY;

        // Create the letter node visual (circle + letter)
        this.createHookZoneLetterNode(nodeX, nodeY, letter, zoneIndex, i);
      });

      // ===== FAKE DISTRACTION NODES =====
      // 3 fake nodes per zone with letters NOT in the target word
      // They look identical to real nodes but prevent word completion
      const wordLetters = new Set(zone.word.split(''));
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const fakeLetterPool = alphabet.split('').filter(c => !wordLetters.has(c));
      // Pick 3 distinct fake letters using zone index as seed for consistency
      const fakeLetters = [
        fakeLetterPool[(zoneIndex * 3 + 0) % fakeLetterPool.length],
        fakeLetterPool[(zoneIndex * 3 + 5) % fakeLetterPool.length],
        fakeLetterPool[(zoneIndex * 3 + 11) % fakeLetterPool.length],
      ];
      // Position fake nodes at midpoints between real nodes for even spacing
      const realNodeXPositions: number[] = [];
      for (let i = 0; i < letters.length; i++) {
        realNodeXPositions.push(zone.start + 40 + (i * nodeSpacingX));
      }
      const midpoints: number[] = [];
      for (let i = 0; i < realNodeXPositions.length - 1; i++) {
        midpoints.push((realNodeXPositions[i] + realNodeXPositions[i + 1]) / 2);
      }
      // Pick 3 well-distributed midpoints depending on word length
      const fakeGapIndices = letters.length <= 5 ? [0, 1, 3] : [0, 2, 4];
      const fakeYOffsets = [20, -60, 10];
      const fakePositions = fakeGapIndices.map((gi, fi) => ({
        x: midpoints[gi],
        y: baseY + fakeYOffsets[fi],
      }));
      fakeLetters.forEach((fakeLetter, fi) => {
        const pos = fakePositions[fi];
        this.createHookZoneLetterNode(pos.x, pos.y, fakeLetter, zoneIndex, letters.length + fi);
      });

      // ===== DENSE SPIKE FIELD =====
      // Fill the gap with spikes - player cannot walk through
      for (let x = zone.start + 25; x < zone.end - 25; x += 35) {
        this.addHazardSpike(x, groundY - 20);
      }

      // ===== LAVA PIT AT BOTTOM =====
      // Wide lava pool spanning the hook zone
      this.addLavaPool(zoneCenterX, groundY - 5, zoneWidth - 50, 15);

      // ===== FLOATING HAZARD (just one per zone) =====
      // Positioned to not block the letter path
      this.addMovingHazard(
        zoneCenterX,
        groundY - 80,
        26, 24,
        'x',
        80,
        45
      );

      // ===== PLATFORM-LEVEL HAZARDS (forces use of hook/grapple mechanic) =====
      // Vertically moving hazards that sweep through platform heights
      // Makes standing on platforms dangerous - player must grapple to letter nodes to survive
      const bandY = this.spawnPoint.y - 40;

      // Left-side vertical sweeper
      this.addMovingHazard(
        zone.start + zoneWidth * 0.3,
        bandY - 80,
        22, 22,
        'y',
        70,
        40
      );

      // Right-side vertical sweeper
      this.addMovingHazard(
        zone.start + zoneWidth * 0.7,
        bandY - 50,
        22, 22,
        'y',
        60,
        35
      );
    });
  }

  // Helper method to create letter nodes inside hook zones
  private createHookZoneLetterNode(x: number, y: number, letter: string, zoneIndex: number, letterIndex: number) {
    // Alternate colors for visual variety
    const useAltColor = letterIndex % 2 === 0;
    const nodeColor = useAltColor ? 0x10b981 : 0x3b82f6; // Green or blue

    // Create circular node background
    const circle = this.add.circle(x, y, 28, nodeColor, 0.9);
    circle.setStrokeStyle(3, 0x1e40af);
    circle.setDepth(9);
    this.nodeCircles.push(circle);

    // Create letter text centered in node
    const text = this.add.text(x, y, letter, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '26px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    });
    text.setOrigin(0.5, 0.5);
    text.setDepth(10);

    // Store data for hook/traversal system
    const landingY = y - 20; // Player landing position above node
    text.setData('landingX', x);
    text.setData('landingY', landingY);
    text.setData('letter', letter);
    text.setData('index', zoneIndex * 10 + letterIndex);
    text.setData('isRequired', true);
    text.setData('nodeCircle', circle);
    text.setData('originalColor', nodeColor);

    // Make interactive for hook targeting
    text.setInteractive({ useHandCursor: true });

    // Hover effects
    text.on('pointerover', () => {
      if (!this.isTraversing && !this.isTransitioningWords) {
        circle.setFillStyle(0xfbbf24, 1.0); // Yellow highlight
        circle.setScale(1.15);
        text.setScale(1.15);
      }
    });

    text.on('pointerout', () => {
      if (!this.isTraversing && !this.isTransitioningWords) {
        circle.setFillStyle(nodeColor, 0.9);
        circle.setScale(1);
        text.setScale(1);
      }
    });

    // Click to traverse (hook to this node)
    text.on('pointerdown', () => this.handleLetterClick(text));

    this.letters.push(text);
  }

  private buildHazards() {
    // ========== ADDITIONAL HAZARDS (outside hook zones) ==========
    // Hook zones already have their own dense hazards (spikes, lava, moving hazards)
    // These are light hazards in the regular platforming sections for variety
    const bandY = this.spawnPoint.y;

    // A few scattered spikes in safe areas (not dense - just for variety)
    const lightSpikes = [
      { x: 1300, y: bandY - 5 },
      { x: 2300, y: bandY - 5 },
      { x: 4500, y: bandY - 5 },
      { x: 6000, y: bandY - 5 },
      { x: 7500, y: bandY - 5 },
    ];
    lightSpikes.forEach((def) => this.addHazardSpike(def.x, def.y));

    // Add demons
    this.buildDemons();
  }

  private addHazardSpike(x: number, y: number) {
    const spike = this.add.triangle(
      x,
      y,
      -12,
      18,
      0,
      -2,
      12,
      18,
      0xff4050
    ).setOrigin(0.5, 1);

    this.physics.add.existing(spike, true);
    const body = spike.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(24, 20);
    body.setOffset(-12, -18);
    body.updateFromGameObject();
    this.hazardGroup.add(spike);
  }

  private addLavaPool(x: number, y: number, width: number, height: number) {
    // Create pixel art lava texture
    if (!this.textures.exists('lava')) {
      const g = this.add.graphics();
      
      // Lava base (dark red)
      g.fillStyle(0xdc2626, 1);
      g.fillRect(0, 0, 16, 10);
      
      // Lava bubbles (bright orange)
      g.fillStyle(0xf97316, 1);
      g.fillRect(2, 2, 2, 2);
      g.fillRect(8, 1, 3, 3);
      g.fillRect(12, 3, 2, 2);
      
      // Lava highlights (yellow)
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(3, 3, 1, 1);
      g.fillRect(9, 2, 1, 1);
      g.fillRect(13, 4, 1, 1);
      
      g.generateTexture('lava', 16, 10);
      g.destroy();
    }

    // Create tiled lava using the texture
    const tilesX = Math.ceil(width / 16);
    
    for (let tx = 0; tx < tilesX; tx++) {
      const tileX = x - width/2 + tx * 16 + 8;
      const lavaSprite = this.add.image(tileX, y, 'lava').setDepth(1);
      
      // Animate lava bubbling
      this.tweens.add({
        targets: lavaSprite,
        scaleY: 1.1,
        duration: 600 + Math.random() * 400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
    
    // Add glow effect
    const glow = this.add.rectangle(x, y, width + 6, height + 6, 0xff8800, 0.3)
      .setOrigin(0.5, 0.5)
      .setDepth(0);
    
    this.tweens.add({
      targets: glow,
      alpha: 0.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Create invisible physics body
    const lava = this.add.rectangle(x, y, width, height, 0xff6600, 0)
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    
    this.physics.add.existing(lava, true);
    const body = lava.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(width, height);
    body.updateFromGameObject();
    this.hazardGroup.add(lava);
  }

  private addMovingHazard(
    x: number,
    y: number,
    width: number,
    height: number,
    axis: 'x' | 'y',
    range: number,
    speed: number
  ) {
    const glow = this.add
      .rectangle(x, y, width + 10, height + 10, 0xff8a8a, 0.36)
      .setOrigin(0.5, 0.5)
      .setDepth(3);
    glow.setBlendMode(Phaser.BlendModes.ADD);

    this.tweens.add({
      targets: glow,
      alpha: { from: 0.24, to: 0.56 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const rect = this.add
      .rectangle(x, y, width, height, 0xff5c5c)
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setStrokeStyle(2, 0xffffff, 1);
    this.physics.add.existing(rect);
    const body = rect.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.setVelocity(axis === 'x' ? speed : 0, axis === 'y' ? speed : 0);

    this.movingHazards.push({
      shape: rect,
      glow,
      body,
      axis,
      min: axis === 'x' ? x - range : y - range,
      max: axis === 'x' ? x + range : y + range,
      speed,
    });

    this.physics.add.overlap(this.player, rect, () => this.handleHazardHit(), undefined, this);
  }


  private activateCheckpoint() {
    if (this.checkpointReached) return;

    this.checkpointReached = true;
    console.log('🚩 CHECKPOINT ACTIVATED! You will now respawn here if you die.');

    // Visual feedback - green flash
    this.cameras.main.flash(400, 100, 255, 100, false);
    
    // Show "CHECKPOINT ACTIVATED" text
    const checkpointText = this.add.text(
      this.player.x,
      this.player.y - 60,
      'CHECKPOINT ACTIVATED!',
      {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#00ff00',
        stroke: '#000000',
        strokeThickness: 4,
      }
    )
    .setOrigin(0.5)
    .setDepth(100)
    .setScrollFactor(1);

    // Animate text
    this.tweens.add({
      targets: checkpointText,
      y: this.player.y - 100,
      alpha: 0,
      duration: 2000,
      ease: 'Sine.easeOut',
      onComplete: () => checkpointText.destroy(),
    });
    
    // Particle burst from player
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      const dist = 40;
      const particle = this.add.rectangle(
        this.player.x,
        this.player.y,
        8,
        8,
        0x00ff00
      ).setDepth(11);
      
      this.tweens.add({
        targets: particle,
        x: this.player.x + Math.cos(angle) * dist,
        y: this.player.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 800,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }


  private buildDemons() {
    // Create demon texture
    if (!this.textures.exists('demon')) {
      const g = this.add.graphics();
      
      // Demon body (dark red)
      g.fillStyle(0xdc2626, 1);
      g.fillRect(4, 10, 16, 14);
      
      // Demon head (darker red)
      g.fillStyle(0x991b1b, 1);
      g.fillRect(6, 4, 12, 10);
      
      // Horns (black)
      g.fillStyle(0x000000, 1);
      g.fillRect(5, 2, 2, 4);
      g.fillRect(17, 2, 2, 4);
      
      // Eyes (glowing yellow)
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(8, 7, 2, 2);
      g.fillRect(14, 7, 2, 2);
      
      // Eye glow (bright yellow)
      g.fillStyle(0xfef3c7, 1);
      g.fillRect(9, 8, 1, 1);
      g.fillRect(15, 8, 1, 1);
      
      // Claws (black)
      g.fillStyle(0x000000, 1);
      g.fillRect(2, 14, 3, 2);
      g.fillRect(19, 14, 3, 2);
      
      // Wings (dark red)
      g.fillStyle(0x7f1d1d, 1);
      g.fillRect(0, 8, 4, 8);
      g.fillRect(20, 8, 4, 8);
      
      g.generateTexture('demon', 24, 24);
      g.destroy();
    }

    // Create magic projectile texture
    if (!this.textures.exists('magic_bolt')) {
      const g = this.add.graphics();
      
      // Magic bolt core (cyan)
      g.fillStyle(0x06b6d4, 1);
      g.fillRect(2, 2, 8, 8);
      
      // Magic bolt glow (light cyan)
      g.fillStyle(0x67e8f9, 1);
      g.fillRect(3, 3, 6, 6);
      
      // Magic bolt center (white)
      g.fillStyle(0xffffff, 1);
      g.fillRect(4, 4, 4, 4);
      
      g.generateTexture('magic_bolt', 12, 12);
      g.destroy();
    }

    // Spawn demons ONLY in non-hook-zone gaps
    // Hook zones: 700-1400, 2050-2750, 3400-4100, 4750-5450, 6500-7300
    // Safe gaps: 0-700, 1400-2050, 2750-3400, 4100-4750, 5450-6500, 7300+
    const demonSpawns = [
      { x: 500, y: this.spawnPoint.y - 60 },     // Before Zone 1
      { x: 1600, y: this.spawnPoint.y - 100 },    // Gap: Z1-Z2
      { x: 1900, y: this.spawnPoint.y - 80 },     // Gap: Z1-Z2
      { x: 2900, y: this.spawnPoint.y - 80 },     // Gap: Z2-Z3
      { x: 3200, y: this.spawnPoint.y - 100 },    // Gap: Z2-Z3
      { x: 4300, y: this.spawnPoint.y - 80 },     // Gap: Z3-Z4
      { x: 4550, y: this.spawnPoint.y - 70 },     // Gap: Z3-Z4
      { x: 5700, y: this.spawnPoint.y - 90 },     // Gap: Z4-Z5
      { x: 6100, y: this.spawnPoint.y - 110 },    // Gap: Z4-Z5
      { x: 6300, y: this.spawnPoint.y - 70 },     // Gap: Z4-Z5
      { x: 7500, y: this.spawnPoint.y - 80 },     // After Z5 to end
      { x: 7800, y: this.spawnPoint.y - 100 },    // After Z5 to end
      { x: 8100, y: this.spawnPoint.y - 70 },     // After Z5 to end
    ];

    console.log(`🔥 Spawning ${demonSpawns.length} demons...`);
    demonSpawns.forEach((spawn, index) => {
      console.log(`Spawning demon ${index + 1} at (${spawn.x}, ${spawn.y})`);
      this.addDemon(spawn.x, spawn.y);
    });

    // Set up demon collisions with platforms
    this.setupDemonCollisions();
  }

  private addDemon(x: number, y: number) {
    if (this.isInsideAnyHookZone(x)) return;
    console.log(`Creating demon at (${x}, ${y})`);
    
    const demon = this.add.image(x, y, 'demon')
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setVisible(true);
    
    this.physics.add.existing(demon);
    const body = demon.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setSize(20, 20);
    body.setBounce(0.3);
    body.setCollideWorldBounds(true);

    // Add collision with ground and platforms (we'll set this up after all platforms are created)
    // For now, demons will use gravity and world bounds

    const demonData = {
      sprite: demon,
      body,
      health: 3,
      chaseSpeed: 100, // Increased base speed for more aggressive chasing
      attackCooldown: 0,
      isStunned: false,
      stunDuration: 0,
    };

    this.demons.push(demonData);
    console.log(`Demon created! Total demons: ${this.demons.length}`);

    // Demons attack player on close contact
    this.physics.add.overlap(this.player, demon, () => {
      const demonObj = this.demons.find(d => d.sprite === demon);
      if (demonObj && demonObj.attackCooldown <= 0) {
        this.handleDemonAttack(demonObj);
      }
    }, undefined, this);
  }

  private handleAttack() {
    if (this.isAttacking || this.attackCooldown > 0) return;

    this.isAttacking = true;
    this.attackCooldown = 500; // 500ms cooldown

    console.log('🔥 Mage attacks!');

    // Create magic projectile
    const projectile = this.add.image(this.player.x, this.player.y - 10, 'magic_bolt')
      .setDepth(10);

    this.physics.add.existing(projectile);
    const projBody = projectile.body as Phaser.Physics.Arcade.Body;
    projBody.setAllowGravity(false);
    
    // Determine attack direction based on player's last movement or facing
    const attackDirection = this.player.flipX ? -1 : 1;
    projBody.setVelocityX(attackDirection * 400);

    this.magicProjectiles.push(projectile);

    // Projectile collision with demons
    this.physics.add.overlap(projectile, this.demons.map(d => d.sprite), 
      (proj, demonSprite) => this.handleProjectileHit(proj as Phaser.GameObjects.Image, demonSprite as Phaser.GameObjects.Image), 
      undefined, this);

    // Remove projectile after 2 seconds
    this.time.delayedCall(2000, () => {
      const index = this.magicProjectiles.indexOf(projectile);
      if (index > -1) {
        this.magicProjectiles.splice(index, 1);
        projectile.destroy();
      }
    });

    // Attack animation effect
    this.tweens.add({
      targets: this.player,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 100,
      yoyo: true,
      ease: 'Back.easeOut',
    });

    // Reset attack state
    this.time.delayedCall(200, () => {
      this.isAttacking = false;
    });
  }

  private handleProjectileHit(projectile: Phaser.GameObjects.Image, demonSprite: Phaser.GameObjects.Image) {
    // Find the demon that was hit
    const demon = this.demons.find(d => d.sprite === demonSprite);
    if (!demon) return;

    // Damage demon
    demon.health--;
    console.log(`💥 Demon hit! Health: ${demon.health}`);

    // Visual feedback
    this.cameras.main.shake(50, 0.005);
    
    // Demon flash red
    demon.sprite.setTint(0xff0000);
    this.time.delayedCall(100, () => {
      if (demon.sprite.active) {
        demon.sprite.clearTint();
      }
    });

    // Create hit particles
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 20;
      const particle = this.add.rectangle(
        demonSprite.x,
        demonSprite.y,
        4,
        4,
        0xfbbf24
      ).setDepth(11);
      
      this.tweens.add({
        targets: particle,
        x: demonSprite.x + Math.cos(angle) * dist,
        y: demonSprite.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 300,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    // Remove projectile
    const projIndex = this.magicProjectiles.indexOf(projectile);
    if (projIndex > -1) {
      this.magicProjectiles.splice(projIndex, 1);
    }
    projectile.destroy();

    // Kill demon if health reaches 0
    if (demon.health <= 0) {
      this.killDemon(demon);
    }
  }

  private killDemon(demon: any) {
    console.log('☠️ Demon defeated!');

    // Remove ice block if demon was frozen
    if (demon.sprite.getData('isFrozen')) {
      const iceBlock = demon.sprite.getData('iceBlock');
      if (iceBlock && iceBlock.active) {
        iceBlock.destroy();
      }
    }
    
    // Remove charred overlay if demon was charred
    if (demon.sprite.getData('isCharred')) {
      const charredOverlay = demon.sprite.getData('charredOverlay');
      if (charredOverlay && charredOverlay.active) {
        charredOverlay.destroy();
      }
    }
    
    // Remove lightning bolt if demon was paralyzed
    if (demon.sprite.getData('isParalyzed')) {
      const lightningBolt = demon.sprite.getData('lightningBolt');
      if (lightningBolt && lightningBolt.active) {
        lightningBolt.destroy();
      }
    }

    // Death explosion effect
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const dist = 30;
      const particle = this.add.rectangle(
        demon.sprite.x,
        demon.sprite.y,
        6,
        6,
        0xdc2626
      ).setDepth(11);
      
      this.tweens.add({
        targets: particle,
        x: demon.sprite.x + Math.cos(angle) * dist,
        y: demon.sprite.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.1,
        duration: 500,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    // Remove demon from arrays and destroy sprite
    const index = this.demons.indexOf(demon);
    if (index > -1) {
      this.demons.splice(index, 1);
    }
    demon.sprite.destroy();
  }

  private setupDemonCollisions() {
    // Find all platform objects and set up collisions with demons
    this.physics.world.staticBodies.entries.forEach((body) => {
      const gameObject = body.gameObject;
      if (gameObject && gameObject.getData && gameObject.getData('isPlatform')) {
        this.demons.forEach(demon => {
          this.physics.add.collider(demon.sprite, gameObject);
        });
      }
    });
    console.log(`Set up collisions for ${this.demons.length} demons with platforms`);
  }

  private updateDemons() {
    this.demons.forEach(demon => {
      const { sprite, body, chaseSpeed } = demon;
      
      // Update ice block position if frozen
      if (sprite.getData('isFrozen')) {
        const iceBlock = sprite.getData('iceBlock');
        if (iceBlock && iceBlock.active) {
          iceBlock.setPosition(sprite.x, sprite.y);
        }
      }
      
      // Update charred overlay position if charred
      if (sprite.getData('isCharred')) {
        const charredOverlay = sprite.getData('charredOverlay');
        if (charredOverlay && charredOverlay.active) {
          charredOverlay.setPosition(sprite.x, sprite.y);
          charredOverlay.setScale(sprite.scaleX, sprite.scaleY);
        }
      }
      
      // Update lightning bolt position if paralyzed
      if (sprite.getData('isParalyzed')) {
        const lightningBolt = sprite.getData('lightningBolt');
        if (lightningBolt && lightningBolt.active) {
          lightningBolt.setPosition(sprite.x, sprite.y - 15);
        }
      }
      
      // Handle stun duration
      if (demon.isStunned) {
        demon.stunDuration -= 16; // Assuming 60fps
        
        if (demon.stunDuration <= 0) {
          // Remove stun effect
          demon.isStunned = false;
          demon.sprite.clearTint();
          demon.sprite.setAngle(0); // Reset rotation
          console.log('💫 Demon recovered from stun!');
        } else {
          // Skip AI update while stunned
          return;
        }
      }
      
      // HOOK ZONE CONTAINMENT - Prevent demons from entering hook zones
      for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
        const zone = this.hookZoneDefinitions[i];
        if (sprite.x > zone.start && sprite.x < zone.end) {
          // Demon is inside a hook zone - push it out to nearest edge
          const distToStart = sprite.x - zone.start;
          const distToEnd = zone.end - sprite.x;
          if (distToStart < distToEnd) {
            sprite.x = zone.start - 10;
          } else {
            sprite.x = zone.end + 10;
          }
          body.setVelocityX(0);
          break;
        }
      }

      // Calculate distance to player
      const distanceToPlayer = Phaser.Math.Distance.Between(
        sprite.x, sprite.y,
        this.player.x, this.player.y
      );

      // Don't chase player into hook zones
      let playerInHookZone = false;
      for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
        const zone = this.hookZoneDefinitions[i];
        if (this.player.x >= zone.start && this.player.x <= zone.end) {
          playerInHookZone = true;
          break;
        }
      }

      // Chase player if within range (600 pixels) and player is NOT in a hook zone
      if (distanceToPlayer < 600 && !playerInHookZone) {
        const directionX = this.player.x > sprite.x ? 1 : -1;
        const directionY = this.player.y < sprite.y ? -1 : 1;
        
        // Enhanced horizontal movement with adaptive speed
        const adaptiveSpeed = this.calculateAdaptiveSpeed(demon, distanceToPlayer);
        body.setVelocityX(directionX * adaptiveSpeed);
        
        // Flip sprite based on direction
        sprite.setFlipX(directionX < 0);

        // INTELLIGENT PLATFORM JUMPING SYSTEM
        const isOnGround = body.blocked.down;
        const playerIsAbove = this.player.y < sprite.y - 30;
        const playerIsFarAbove = this.player.y < sprite.y - 80;
        const playerIsWayAbove = this.player.y < sprite.y - 150;
        const horizontalDistance = Math.abs(this.player.x - sprite.x);
        const verticalDistance = Math.abs(this.player.y - sprite.y);
        
        if (isOnGround) {
          // SMART PLATFORM DETECTION AND JUMPING
          const nearbyPlatform = this.findNearbyPlatform(sprite.x, sprite.y, directionX);
          
          // Jump to reach player on platforms above
          if (playerIsAbove && horizontalDistance < 200) {
            if (playerIsWayAbove) {
              body.setVelocityY(-500); // Super jump for very high platforms
            } else if (playerIsFarAbove) {
              body.setVelocityY(-450); // High jump for far platforms
            } else {
              body.setVelocityY(-350); // Normal jump for nearby platforms
            }
          }
          // Jump onto detected nearby platforms to continue chase
          else if (nearbyPlatform && horizontalDistance > 40) {
            const platformHeight = nearbyPlatform.y - sprite.y;
            if (platformHeight < -20 && platformHeight > -200) {
              // Calculate jump strength based on platform height
              const jumpStrength = Math.min(500, 300 + Math.abs(platformHeight) * 1.5);
              body.setVelocityY(-jumpStrength);
              console.log(`👹 Demon jumping to platform at height ${platformHeight}, jump strength: ${jumpStrength}`);
            }
          }
          // Aggressive pursuit jumps when player is nearby but not directly above
          else if (horizontalDistance > 60 && horizontalDistance < 180 && verticalDistance > 50) {
            body.setVelocityY(-320);
          }
          // Random aggressive jumps when close for unpredictability
          else if (distanceToPlayer < 120 && Math.random() > 0.97) {
            body.setVelocityY(-280);
          }
          // Jump over small obstacles
          else if (horizontalDistance < 100 && this.isObstacleInFront(sprite, directionX)) {
            body.setVelocityY(-250);
          }
        }

        // ENHANCED WALL JUMPING - More intelligent wall detection
        const hitWall = (body.blocked.left && directionX < 0) || (body.blocked.right && directionX > 0);
        if (hitWall) {
          if (isOnGround) {
            // Jump higher if player is above when hitting wall
            if (playerIsAbove) {
              body.setVelocityY(-450);
            } else {
              body.setVelocityY(-300);
            }
          }
          // Try to find alternative path around wall
          this.handleWallObstacle(demon, directionX);
        }

        // ADAPTIVE SPEED SYSTEM - Speed up when close, maintain pursuit when far
        if (horizontalDistance < 150) {
          // Increase speed when very close for final pursuit
          body.setVelocityX(directionX * (chaseSpeed * 1.5));
        } else if (horizontalDistance < 300) {
          // Normal enhanced speed when moderately close
          body.setVelocityX(directionX * (chaseSpeed * 1.2));
        }

        // VERTICAL PURSUIT - Try to match player's vertical position
        if (Math.abs(body.velocity.y) < 50 && verticalDistance > 100 && isOnGround) {
          // Small hop to try to get closer vertically
          if (Math.random() > 0.95) {
            body.setVelocityY(-200);
          }
        }

      } else {
        // Gradual slowdown but maintain some movement (demons don't give up easily)
        body.setVelocityX(body.velocity.x * 0.85);
      }

      // Prevent demon from moving into a hook zone (velocity clamp)
      for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
        const zone = this.hookZoneDefinitions[i];
        // About to enter from the left
        if (sprite.x < zone.start && sprite.x > zone.start - 30 && body.velocity.x > 0) {
          body.setVelocityX(0);
          sprite.x = zone.start - 10;
        }
        // About to enter from the right
        if (sprite.x > zone.end && sprite.x < zone.end + 30 && body.velocity.x < 0) {
          body.setVelocityX(0);
          sprite.x = zone.end + 10;
        }
      }

      // Demon attacks player if very close (and player is not in a hook zone)
      if (distanceToPlayer < 40 && demon.attackCooldown <= 0 && !playerInHookZone) {
        this.handleDemonAttack(demon);
        demon.attackCooldown = 800; // Slightly faster attack rate
      }

      // Reduce attack cooldown
      if (demon.attackCooldown > 0) {
        demon.attackCooldown -= 16; // Assuming 60fps
      }

      // ANTI-STUCK SYSTEM - More sophisticated stuck detection and recovery
      this.handleDemonStuckRecovery(demon, distanceToPlayer);
    });
  }

  private calculateAdaptiveSpeed(demon: any, distanceToPlayer: number): number {
    const baseSpeed = demon.chaseSpeed;
    
    // Speed increases as demon gets closer to player
    if (distanceToPlayer < 100) {
      return baseSpeed * 1.6; // Very fast when very close
    } else if (distanceToPlayer < 200) {
      return baseSpeed * 1.3; // Fast when close
    } else if (distanceToPlayer < 400) {
      return baseSpeed * 1.1; // Slightly faster when in range
    } else {
      return baseSpeed; // Normal speed when far
    }
  }

  private findNearbyPlatform(demonX: number, demonY: number, direction: number): { x: number; y: number } | null {
    // Search for platforms in the direction the demon is moving
    const searchDistance = 150;
    const searchX = demonX + (direction * searchDistance);
    
    // Check static bodies (platforms) for nearby platforms
    let nearestPlatform: { x: number; y: number } | null = null;
    let nearestDistance = Infinity;
    
    this.physics.world.staticBodies.entries.forEach((body) => {
      const gameObject = body.gameObject;
      if (gameObject && gameObject.getData && gameObject.getData('isPlatform')) {
        const platformX = body.x + body.halfWidth;
        const platformY = body.y;
        
        // Check if platform is in the right direction and within reasonable distance
        const horizontalDistance = Math.abs(platformX - searchX);
        const verticalDistance = platformY - demonY;
        
        if (horizontalDistance < 80 && verticalDistance < -20 && verticalDistance > -200) {
          const totalDistance = horizontalDistance + Math.abs(verticalDistance);
          if (totalDistance < nearestDistance) {
            nearestDistance = totalDistance;
            nearestPlatform = { x: platformX, y: platformY };
          }
        }
      }
    });
    
    return nearestPlatform;
  }

  private isObstacleInFront(sprite: Phaser.GameObjects.Image, direction: number): boolean {
    // Simple obstacle detection - check if there's a wall or platform directly in front
    const checkDistance = 40;
    const checkX = sprite.x + (direction * checkDistance);
    const checkY = sprite.y;
    
    // This is a simplified check - in a more complex system you'd raycast
    return this.physics.world.staticBodies.entries.some((body) => {
      const gameObject = body.gameObject;
      if (gameObject && gameObject.getData && gameObject.getData('isPlatform')) {
        const distance = Phaser.Math.Distance.Between(checkX, checkY, body.x + body.halfWidth, body.y + body.halfHeight);
        return distance < 30;
      }
      return false;
    });
  }

  private handleWallObstacle(demon: any, direction: number) {
    const { sprite, body } = demon;
    
    // When hitting a wall, try to find a way around it
    // Look for platforms above or gaps to jump through
    const platformAbove = this.findNearbyPlatform(sprite.x, sprite.y - 100, direction);
    
    if (platformAbove && body.blocked.down) {
      // Jump towards the platform above
      body.setVelocityY(-400);
      body.setVelocityX(direction * demon.chaseSpeed * 0.8);
    } else if (Math.random() > 0.9) {
      // Occasionally try to back up and find another path
      body.setVelocityX(-direction * demon.chaseSpeed * 0.5);
    }
  }

  private handleDemonStuckRecovery(demon: any, distanceToPlayer: number) {
    const { sprite, body, chaseSpeed } = demon;
    
    // Detect if demon is stuck (very low velocity while player is nearby)
    const isStuck = Math.abs(body.velocity.x) < 15 && Math.abs(body.velocity.y) < 15 && distanceToPlayer < 400;
    
    if (isStuck && Math.random() > 0.98) {
      console.log('👹 Demon appears stuck, attempting recovery...');
      
      // Try different recovery methods
      const recoveryMethod = Math.floor(Math.random() * 4);
      
      switch (recoveryMethod) {
        case 0:
          // Random jump
          if (body.blocked.down) {
            body.setVelocityY(-300 - Math.random() * 200);
          }
          break;
        case 1:
          // Random horizontal movement
        const randomDirection = Math.random() > 0.5 ? 1 : -1;
          body.setVelocityX(randomDirection * chaseSpeed);
          break;
        case 2:
          // Combination jump and move
        if (body.blocked.down) {
            body.setVelocityY(-250);
            body.setVelocityX((Math.random() > 0.5 ? 1 : -1) * chaseSpeed * 0.7);
          }
          break;
        case 3:
          // Teleport slightly (as last resort for truly stuck demons)
          if (Math.random() > 0.95) {
            const teleportDistance = 50;
            const teleportDirection = this.player.x > sprite.x ? 1 : -1;
            sprite.x += teleportDirection * teleportDistance;
            console.log('👹 Demon teleported to escape being stuck');
          }
          break;
      }
    }
  }

  private handleDemonAttack(demon: any) {
    console.log('👹 Demon attacks player!');
    
    // Player takes damage (respawn)
    this.handleHazardHit();
    
    // Visual feedback for demon attack
    demon.sprite.setTint(0xfbbf24);
    this.time.delayedCall(200, () => {
      if (demon.sprite.active) {
        demon.sprite.clearTint();
      }
    });
  }

  private getHookZoneIndexAtPlayerPosition(): number {
    if (this.currentHookZoneIndex >= 0 && this.hookZoneDefinitions[this.currentHookZoneIndex]) {
      return this.currentHookZoneIndex;
    }

    const playerX = this.player.x;
    for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
      const zone = this.hookZoneDefinitions[i];
      if (playerX >= zone.start && playerX <= zone.end) {
        return i;
      }
    }

    return -1;
  }

  private getHookZoneRespawnPoint(zoneIndex: number): { x: number; y: number } | undefined {
    const zone = this.hookZoneDefinitions[zoneIndex];
    if (!zone) return undefined;

    if (this.hookZoneEntryRespawnPoint && this.hookZoneEntryRespawnPoint.zoneIndex === zoneIndex) {
      return {
        x: this.hookZoneEntryRespawnPoint.x,
        y: this.hookZoneEntryRespawnPoint.y,
      };
    }

    const groundY = this.map.heightInPixels - 16;
    return { x: zone.start - 50, y: groundY - 60 };
  }

  private getCompletedHookZoneExitRespawnPointAtPlayerPosition():
    { zoneIndex: number; x: number; y: number } | undefined {
    const playerX = this.player.x;
    const groundY = this.map.heightInPixels - 16;
    const postZoneRespawnWindow = 220; // "right after" the zone exit

    for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
      if (!this.hookZoneSolved[i]) continue;
      const zone = this.hookZoneDefinitions[i];
      if (playerX > zone.end && playerX <= zone.end + postZoneRespawnWindow) {
        return {
          zoneIndex: i,
          x: zone.end + 50,
          y: groundY - 60,
        };
      }
    }

    return undefined;
  }

  private respawnAtCompletedHookZoneExitIfNeeded(): boolean {
    const respawnPoint = this.getCompletedHookZoneExitRespawnPointAtPlayerPosition();
    if (!respawnPoint) return false;

    this.player.setPosition(respawnPoint.x, respawnPoint.y);
    console.log(
      `💀 Died after solved hook zone ${respawnPoint.zoneIndex + 1}. Respawning at zone exit: (${respawnPoint.x}, ${respawnPoint.y})`
    );
    return true;
  }

  private respawnOutsideHookZoneEntranceIfNeeded(): boolean {
    const zoneIndex = this.getHookZoneIndexAtPlayerPosition();
    if (zoneIndex < 0) return false;

    const respawnPoint = this.getHookZoneRespawnPoint(zoneIndex);
    if (!respawnPoint) return false;

    this.player.setPosition(respawnPoint.x, respawnPoint.y);
    console.log(
      `💀 Died in hook zone ${zoneIndex + 1}! Respawning BEFORE zone at: (${respawnPoint.x}, ${respawnPoint.y})`
    );
    this.exitHookZone();
    return true;
  }

  private resetActiveHookZoneProgressOnDeath() {
    if (!this.isInHookZone || this.currentHookZoneIndex < 0) return;
    if (this.hookZoneSolved[this.currentHookZoneIndex]) return;
    if (!this.hookZoneTargetWord) return;

    this.hookZoneCollectedLetters = [];
    this.hookZoneSlotState = new Array(this.hookZoneTargetWord.length).fill(false);
    this.hookZoneFilledLetters = new Array(this.hookZoneTargetWord.length).fill('');
    this.updateHookZoneUI();
  }

  private handleHazardHit() {
    this.resetActiveHookZoneProgressOnDeath();

    this.fireBeamBurnMeter = 0;
    if (this.fireBeamBurnDecayTimer) {
      this.fireBeamBurnDecayTimer.remove();
      this.fireBeamBurnDecayTimer = undefined;
    }

    // Track death (only if died during spell attempt, not during traversal)
    if (this.diedDuringSpell) {
      this.deaths++;
      console.log(`💀 Death count: ${this.deaths} (died during spell attempt)`);
      
      // If 4 or more deaths during spell attempts, show game over review
      if (this.deaths >= 4) {
        this.jumufGameOverReview();
        return; // Don't respawn yet, wait for Enter key
      }
    }
    
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, 0);
    body.setAcceleration(0);
    
    if (this.respawnOutsideHookZoneEntranceIfNeeded()) {
      // Hook-zone deaths are zone-local and do not use global checkpoints
    } else if (this.respawnAtCompletedHookZoneExitIfNeeded()) {
      // Death just after a solved hook zone respawns at that zone's exit
    } else if (this.checkpointReached && this.checkpointPosition) {
      // Respawn at established checkpoint
      this.player.setPosition(this.checkpointPosition.x, this.checkpointPosition.y);
      console.log(`💀 Died! Respawning at CHECKPOINT: (${this.checkpointPosition.x}, ${this.checkpointPosition.y})`);

      // Flash the checkpoint flag to show respawn location (if it exists)
      if (this.checkpointFlag) {
        this.tweens.add({
          targets: this.checkpointFlag,
          alpha: 0.3,
          duration: 100,
          yoyo: true,
          repeat: 3,
          ease: 'Power2.easeInOut'
        });
      }
    } else {
      // Only use spawn point if NO checkpoint has ever been established
      this.player.setPosition(this.spawnPoint.x, this.spawnPoint.y);
      console.log(`⚠️ No checkpoint established yet - respawning at spawn point: (${this.spawnPoint.x}, ${this.spawnPoint.y})`);
    }

    // ===== CRITICAL: Reset hook zone state to prevent crashes =====
    // Stop all player tweens (traversal, suspension floating, etc.)
    this.tweens.killTweensOf(this.player);
    if (this.activeTraversalTween) {
      this.activeTraversalTween.stop();
      this.activeTraversalTween = undefined;
    }

    // Reset traversal and suspension state
    this.isTraversing = false;
    this.isSuspended = false;
    this.manualControlEnabled = true;

    // Clear suspension timer and effects
    if (this.suspensionTimer) {
      this.suspensionTimer.remove();
      this.suspensionTimer = undefined;
    }
    if (this.suspensionGlowEffect) {
      this.tweens.killTweensOf(this.suspensionGlowEffect);
      this.suspensionGlowEffect.destroy();
      this.suspensionGlowEffect = undefined;
    }

    // Clear suspension references
    this.currentSuspendedNode = undefined;
    this.suspensionLandingY = 0;
    // ===== END hook zone state reset =====

    // Reset traversal state (additional cleanup)
    this.resetTraversalState();
    
    // Reset diedDuringSpell flag after handling
    this.diedDuringSpell = false;
    
    // Reset letter progress for current word (but keep the same word)
    this.currentLetterIndex = 0;
    this.collectedLetters = []; // Reset collected letters on death
    this.firstLetterCollected = false; // Reset flag trigger
    
    // DO NOT reset checkpoint - it should persist until a new word is completed!
    
    // Remove tints from all letters and re-enable interaction
    this.letters.forEach((letter) => {
      letter.clearTint();
      letter.setInteractive({ useHandCursor: true }); // Re-enable interaction

      // Reset node circle appearance
      const circle = letter.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;
      const isRequired = letter.getData('isRequired') as boolean;
      if (circle) {
        circle.setAlpha(isRequired ? 0.9 : 0.6); // Reset to original alpha
      }
    });
    
    // Clear collected letters display
    if (this.collectedLettersText) {
      this.collectedLettersText.destroy();
      this.collectedLettersText = undefined;
    }
    
    this.cameras.main.shake(120, 0.01);
  }

  private getLetterPlacements(word: string): { x: number; y: number }[] {
    const bandY = this.spawnPoint.y - 40;

    // ========== LETTER NODE POSITIONS ON PLATFORMS ==========
    // Nodes placed on platforms throughout the level
    // Matching the platform layout from buildManualPlatforms()

    const allPlatformPositions: Platform[] = [
      // Starting area platforms
      { x: 150, y: bandY, width: 200 },
      { x: 400, y: bandY - 60, width: 150 },
      { x: 600, y: bandY - 100, width: 160 },

      // Early section
      { x: 850, y: bandY - 50, width: 180 },
      { x: 1050, y: bandY - 100, width: 150 },
      { x: 1250, y: bandY - 150, width: 140 },

      // Mid-low platforms
      { x: 1450, y: bandY - 80, width: 160 },
      { x: 1650, y: bandY - 40, width: 170 },
      { x: 1850, y: bandY - 100, width: 150 },

      // Climbing section
      { x: 2050, y: bandY - 140, width: 140 },
      { x: 2250, y: bandY - 180, width: 160 },
      { x: 2450, y: bandY - 120, width: 150 },

      // Descent
      { x: 2650, y: bandY - 80, width: 180 },
      { x: 2850, y: bandY - 40, width: 170 },
      { x: 3050, y: bandY - 100, width: 160 },

      // Mid-level platforms
      { x: 3250, y: bandY - 60, width: 180 },
      { x: 3450, y: bandY - 120, width: 150 },
      { x: 3650, y: bandY - 80, width: 170 },

      // Varied heights
      { x: 3850, y: bandY - 40, width: 160 },
      { x: 4050, y: bandY - 100, width: 150 },
      { x: 4250, y: bandY - 150, width: 140 },

      // Easy section
      { x: 4450, y: bandY - 60, width: 180 },
      { x: 4650, y: bandY - 40, width: 170 },
      { x: 4850, y: bandY - 80, width: 160 },

      // Extended area
      { x: 5050, y: bandY - 50, width: 180 },
      { x: 5250, y: bandY - 100, width: 160 },
      { x: 5450, y: bandY - 70, width: 170 },

      { x: 5650, y: bandY - 40, width: 180 },
      { x: 5850, y: bandY - 90, width: 160 },
      { x: 6050, y: bandY - 130, width: 150 },

      { x: 6250, y: bandY - 80, width: 170 },
      { x: 6450, y: bandY - 50, width: 180 },
      { x: 6650, y: bandY - 100, width: 160 },

      { x: 6850, y: bandY - 60, width: 170 },
      { x: 7050, y: bandY - 40, width: 180 },
      { x: 7250, y: bandY - 90, width: 160 },

      { x: 7450, y: bandY - 130, width: 150 },
      { x: 7650, y: bandY - 80, width: 170 },
      { x: 7850, y: bandY - 50, width: 180 },

      { x: 8050, y: bandY - 100, width: 160 },
      { x: 8250, y: bandY - 60, width: 170 },
    ];

    // Define which letters are required for each word
    const requiredLetters: Record<string, string[]> = {
      BLAZE: ['B', 'L', 'A', 'Z', 'E'],
      FROST: ['F', 'R', 'O', 'S', 'T'],
      STORM: ['S', 'T', 'O', 'R', 'M'],
      BLIND: ['B', 'L', 'I', 'N', 'D'],
      HUNGRY: ['H', 'U', 'N', 'G', 'R', 'Y'],
    };

    // Get the required letters for this word
    const wordLetters = requiredLetters[word] || [];
    if (wordLetters.length === 0) return [];

    // Use new node placement system with proper spacing
    const nodes = createNodePlacements(allPlatformPositions, wordLetters);

    // Store the current word's letter mapping for validation
    this.currentWordLetterMap = nodes.map(node => ({
      x: node.x,
      y: node.y,
      letter: node.letter,
      isRequired: node.isRequired
    }));

    // Verify all required letters are present
    const requiredLettersFound = this.currentWordLetterMap
      .filter(p => p.isRequired)
      .map(p => p.letter);
    const missingRequiredLetters = wordLetters.filter(
      letter => !requiredLettersFound.includes(letter)
    );

    console.log(`📝 Word: ${word}`);
    console.log(`📝 Required letters: [${wordLetters.join(', ')}]`);
    console.log(`📝 Required letters spawned: [${requiredLettersFound.join(', ')}]`);
    console.log(`📝 Total nodes created: ${nodes.length}`);

    if (missingRequiredLetters.length > 0) {
      console.error(`❌ MISSING REQUIRED LETTERS: [${missingRequiredLetters.join(', ')}]`);
    } else {
      console.log(`✅ All required letters spawned with proper spacing!`);
    }

    // Return positions for all letters (traversal nodes)
    return this.currentWordLetterMap.map(placement => ({
      x: placement.x,
      y: placement.y
    }));
  }

  // Add property to track current word's letter mapping
  private currentWordLetterMap: { x: number; y: number; letter: string; isRequired: boolean }[] = [];

  private spawnWord(word: string) {
    // ========== LETTER NODES OUTSIDE HOOK ZONES - DISABLED ==========
    // Letter nodes are now ONLY placed inside hook-mandatory zones.
    // The buildHookZones() method creates all letter nodes.
    // This method no longer spawns letters on platforms outside zones.

    // DO NOT clear letters or nodeCircles - they contain the hook zone nodes!
    // Hook zone letter nodes are created by buildHookZones() and must persist.

    console.log(`📝 Word "${word}" registered - letters only in hook zones`);
  }

  private loadNextWord() {
    if (this.currentWordIndex >= this.wordList.length) {
      this.reachAllGoals();
      return;
    }

    this.currentWord = this.wordList[this.currentWordIndex];
    this.currentLetterIndex = 0;
    this.isTransitioningWords = false;
    this.collectedLetters = []; // Reset collected letters for new word
    this.firstLetterCollected = false; // Reset flag trigger for new word

    // Reset word sequence for new word
    this.currentSequence = '';

    console.log(`Loading word ${this.currentWordIndex + 1}/${this.wordList.length}: ${this.currentWord}`);

    // Clear collected letters display
    if (this.collectedLettersText) {
      this.collectedLettersText.destroy();
      this.collectedLettersText = undefined;
    }

    // Clear sequence display
    if (this.sequenceDisplayText) {
      this.sequenceDisplayText.destroy();
      this.sequenceDisplayText = undefined;
    }

    // Remove checkpoint flag for new word
    if (this.checkpointFlag) {
      this.checkpointFlag.destroy();
      this.checkpointFlag = undefined;
    }
    this.checkpointReached = false;

    this.spawnWord(this.currentWord);
  }


  private spawnLetterAtPosition(letter: string, platformX: number, platformY: number, index: number, isRequired: boolean = true) {
    const targetX = platformX;
    const targetY = platformY;  // Node position (already offset from platform)
    const landingY = platformY - this.player.displayHeight / 2;  // Player landing position

    console.log(`Spawning node ${letter} at (${targetX}, ${targetY}), landing at (${targetX}, ${landingY}), required: ${isRequired}`);

    // Create circular node background (blue/green alternating)
    const useAltColor = index % 3 === 0;
    const nodeColor = useAltColor ? 0x10b981 : 0x3b82f6; // Green or blue
    const nodeAlpha = isRequired ? 0.9 : 0.6;

    const circle = this.add.circle(targetX, targetY, 26, nodeColor, nodeAlpha);
    circle.setStrokeStyle(3, 0x1e40af);
    circle.setDepth(9);
    circle.setScrollFactor(1);
    this.nodeCircles.push(circle);

    // Create letter text centered in node
    const letterColor = '#ffffff';
    const text = this.add.text(targetX, targetY, letter, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '24px',
      color: letterColor,
      stroke: '#000000',
      strokeThickness: 3,
    });

    text.setOrigin(0.5, 0.5);
    text.setDepth(10);
    text.setScrollFactor(1);
    text.setAlpha(isRequired ? 1.0 : 0.7);
    text.setInteractive({ useHandCursor: true });
    text.setData('landingX', targetX);
    text.setData('landingY', landingY);
    text.setData('letter', letter);
    text.setData('index', index);
    text.setData('isRequired', isRequired);
    text.setData('nodeCircle', circle); // Link circle to text
    text.setData('originalColor', nodeColor); // Store original color for hover reset

    // Hover effects
    text.on('pointerover', () => {
      if (!this.isTraversing && !this.isTransitioningWords) {
        // Highlight on hover
        circle.setFillStyle(0xfbbf24, 1.0); // Yellow highlight
        circle.setScale(1.1);
        text.setScale(1.1);
      }
    });

    text.on('pointerout', () => {
      if (!this.isTraversing && !this.isTransitioningWords) {
        // Reset to original
        circle.setFillStyle(nodeColor, nodeAlpha);
        circle.setScale(1.0);
        text.setScale(1.0);
      }
    });

    text.on('pointerdown', () => this.handleLetterClick(text));
    this.letters.push(text);

    console.log(`Node ${letter} created at (${text.x}, ${text.y}), required: ${isRequired}`);
  }

  // ========== WORD-GATED HOOK SYSTEM ==========
  // Track current word sequence being built
  private currentSequence: string = '';
  private hookGraphics?: Phaser.GameObjects.Graphics;

  // Air suspension system
  private isSuspended: boolean = false;
  private suspensionTimer?: Phaser.Time.TimerEvent;
  private suspensionStartTime: number = 0;
  private hintFlashActive: boolean = false;
  private currentSuspendedNode?: Phaser.GameObjects.Text; // Node player is currently attached to
  private suspensionGlowEffect?: Phaser.GameObjects.Arc; // Glow effect around suspended player
  private suspensionLandingY: number = 0; // Landing Y position for drop

  // ========== HOOK-DISABLED ZONES ==========
  // DISABLED: Hook is now always enabled so players can use it in Hook Zones
  // The hook zone system handles when hook traversal is meaningful
  private hookDisabledZones: { startX: number; endX: number; name: string }[] = [
    // Empty - hook is enabled everywhere to support hook zone traversal
  ];

  // ========== WORD DICTIONARY SYSTEM ==========
  // SPELL WORDS - Special words that unlock spell attacks (NEVER CHANGE THESE)
  private spellWords = [
    'FROST', 'STORM', 'BLAZE', 'HUNGRY', 'BLIND', 'DREAM'
  ];

  // Common English words for general traversal (expanded dictionary)
  private commonWords = [
    // Spell word prefixes (needed for word building)
    'FR', 'FRO', 'FROS', 'STO', 'STOR', 'BLA', 'BLAZ',
    'HUN', 'HUNG', 'HUNGR', 'BLI', 'BLIN', 'DRE', 'DREA',

    // Common 3-letter words
    'CAT', 'DOG', 'RAT', 'BAT', 'HAT', 'MAT', 'SAT', 'FAT',
    'RUN', 'SUN', 'FUN', 'BUN', 'GUN', 'PUN',
    'CAR', 'BAR', 'JAR', 'TAR', 'FAR', 'WAR',
    'BAD', 'DAD', 'HAD', 'MAD', 'SAD', 'LAD',
    'BIG', 'DIG', 'FIG', 'PIG', 'WIG', 'JIG',
    'RED', 'BED', 'FED', 'LED', 'WED',
    'AND', 'END', 'FOR', 'THE', 'ARE', 'NOT', 'BUT', 'CAN',
    'GET', 'GOT', 'HAS', 'HER', 'HIM', 'HIS', 'HOW', 'ITS',

    // Common 4-letter words
    'WORK', 'WORD', 'WORN', 'WORM', 'WARM',
    'COLD', 'HOLD', 'GOLD', 'BOLD', 'FOLD', 'TOLD', 'SOLD',
    'FIRE', 'WIRE', 'TIRE', 'HIRE',
    'WIND', 'FIND', 'KIND', 'MIND', 'BIND',
    'DARK', 'PARK', 'MARK', 'BARK',
    'JUMP', 'PUMP', 'DUMP', 'BUMP', 'LUMP',
    'HOPE', 'ROPE', 'DOPE', 'COPE',
    'MAKE', 'TAKE', 'BAKE', 'CAKE', 'WAKE', 'LAKE', 'FAKE',
    'STAR', 'SCAR', 'SOAR',
    'BORN', 'CORN', 'HORN', 'TORN', 'WORN',
    'OVER', 'MOVE', 'LOVE', 'GIVE', 'HAVE', 'COME', 'SOME',
    'THEN', 'WHEN', 'THAN', 'THAT', 'THIS', 'WITH', 'THEM',

    // Common 5-letter words
    'MAGIC', 'LIGHT', 'FIGHT', 'NIGHT', 'RIGHT', 'SIGHT', 'TIGHT',
    'SPACE', 'PLACE', 'TRACE', 'GRACE',
    'POWER', 'TOWER', 'LOWER',
    'BRAVE', 'GRAVE', 'CRAVE',
    'CREAM', 'STEAM', 'GLEAM',
    'WHICH', 'WOULD', 'COULD', 'THEIR', 'ABOUT', 'AFTER', 'AGAIN',
  ];

  // Combined validation list (spell words + common words)
  private get validWords(): string[] {
    return [...this.spellWords, ...this.commonWords];
  }

  /**
   * Check if a word is a special spell word
   */
  private isSpellWord(word: string): boolean {
    return this.spellWords.includes(word.toUpperCase());
  }

  /**
   * Check if a sequence is a valid word or valid prefix
   */
  private isValidSequence(sequence: string): boolean {
    const upper = sequence.toUpperCase();

    // Check if it's a complete valid word
    if (this.validWords.includes(upper)) {
      return true;
    }

    // Check if it's a valid prefix of any word
    return this.validWords.some(word => word.startsWith(upper));
  }

  /**
   * Show hook animation from player to target
   */
  private showHookAnimation(targetX: number, targetY: number, isValid: boolean) {
    // Reuse existing graphics object instead of create/destroy cycle
    if (!this.hookGraphics) {
      this.hookGraphics = this.add.graphics();
      this.hookGraphics.setDepth(8);
      this.hookGraphics.setScrollFactor(1);
    }

    this.hookGraphics.clear();

    const startX = this.player.x;
    const startY = this.player.y;

    const lineColor = isValid ? 0x60a5fa : 0xef4444;
    const lineAlpha = isValid ? 0.8 : 0.5;

    this.hookGraphics.lineStyle(3, lineColor, lineAlpha);
    this.hookGraphics.beginPath();
    this.hookGraphics.moveTo(startX, startY);
    this.hookGraphics.lineTo(targetX, targetY);
    this.hookGraphics.strokePath();

    // Clear after animation delay
    this.time.delayedCall(isValid ? 900 : 400, () => {
      if (this.hookGraphics) {
        this.hookGraphics.clear();
      }
    });
  }

  /**
   * Show visual feedback for invalid selection
   */
  private showInvalidFeedback(letterText: Phaser.GameObjects.Text) {
    const circle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;

    // Red flash on node
    if (circle) {
      const originalColor = circle.fillColor;
      circle.setFillStyle(0xef4444, 0.8); // Red

      this.time.delayedCall(200, () => {
        if (circle && circle.scene) {
          circle.setFillStyle(originalColor, 0.9);
        }
      });
    }

    // Shake animation
    this.tweens.add({
      targets: letterText,
      x: letterText.x + 5,
      duration: 50,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.inOut'
    });

    // Shake node circle too
    if (circle) {
      this.tweens.add({
        targets: circle,
        x: circle.x + 5,
        duration: 50,
        yoyo: true,
        repeat: 3,
        ease: 'Sine.inOut'
      });
    }
  }

  /**
   * Show visual feedback for valid selection
   */
  private showValidFeedback(letterText: Phaser.GameObjects.Text) {
    const circle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;

    // Green glow on valid selection
    if (circle) {
      circle.setFillStyle(0x10b981, 1.0); // Bright green

      // Pulse animation
      this.tweens.add({
        targets: circle,
        scaleX: 1.15,
        scaleY: 1.15,
        duration: 150,
        yoyo: true,
        ease: 'Sine.inOut'
      });
    }

    // Scale up text briefly
    this.tweens.add({
      targets: letterText,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 150,
      yoyo: true,
      ease: 'Sine.inOut'
    });
  }

  /**
   * Update the sequence display UI
   * DISABLED: Global "Building:" UI removed - hook zone UI handles word display
   */
  private updateSequenceDisplay() {
    // Clean up any existing display
    if (this.sequenceDisplayText) {
      this.sequenceDisplayText.destroy();
      this.sequenceDisplayText = undefined;
    }
    // DO NOT create new text - the hook zone UI handles word display
  }

  // ========== TUTORIAL & GUIDANCE SYSTEM ==========
  private tutorialOverlay?: Phaser.GameObjects.Container;
  private tutorialShown: boolean = false;

  /**
   * Show centered tutorial overlay (10 seconds)
   */
  private showHookTutorial() {
    if (this.tutorialShown) return;
    this.tutorialShown = true;

    const centerX = this.cameras.main.width / 2;
    const centerY = this.cameras.main.height / 2;

    // Semi-transparent background
    const bg = this.add.rectangle(centerX, centerY, 600, 380, 0x000000, 0.85);
    bg.setScrollFactor(0);
    bg.setDepth(2000);

    // Title text
    const title = this.add.text(centerX, centerY - 150, '🪝 HOOK TRAVERSAL', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '32px',
      color: '#fbbf24',
      stroke: '#000000',
      strokeThickness: 4,
      fontStyle: 'bold'
    });
    title.setOrigin(0.5);
    title.setScrollFactor(0);
    title.setDepth(2001);

    // Instructions
    const instructions = this.add.text(
      centerX, centerY - 30,
      'Click letter nodes to form words\nValid words pull you across gaps\n\nExamples: CAT, FROST, DREAM\n\nUse WASD to move normally\nUse hooks when jumping is impossible',
      {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center',
        lineSpacing: 8
      }
    );
    instructions.setOrigin(0.5);
    instructions.setScrollFactor(0);
    instructions.setDepth(2001);

    // Countdown timer (INCREASED to 30 seconds for better learning)
    const timer = this.add.text(centerX, centerY + 155, '30', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '24px',
      color: '#60a5fa',
      stroke: '#000000',
      strokeThickness: 3,
    });
    timer.setOrigin(0.5);
    timer.setScrollFactor(0);
    timer.setDepth(2001);

    // Store in container for easy cleanup
    this.tutorialOverlay = this.add.container(0, 0, [bg, title, instructions, timer]);
    this.tutorialOverlay.setDepth(2000);

    // Countdown animation (30 seconds total)
    let countdown = 30;
    const countdownInterval = this.time.addEvent({
      delay: 1000,
      repeat: 29, // 30 iterations
      callback: () => {
        countdown--;
        timer.setText(countdown.toString());

        if (countdown === 0) {
          // Fade out and destroy
          this.tweens.add({
            targets: this.tutorialOverlay,
            alpha: 0,
            duration: 500,
            onComplete: () => {
              if (this.tutorialOverlay) {
                this.tutorialOverlay.destroy();
                this.tutorialOverlay = undefined;
              }
            }
          });
        }
      }
    });

    // Optional: Allow player to close early with click
    bg.setInteractive();
    bg.on('pointerdown', () => {
      if (this.tutorialOverlay) {
        countdownInterval.remove();
        this.tutorialOverlay.destroy();
        this.tutorialOverlay = undefined;
      }
    });
  }

  /**
   * Djinn gives guidance when player is in difficult area
   */
  private giveDjinnHookGuidance() {
    const guidance = [
      "Try using the hook to traverse this gap!",
      "Form words by clicking letter nodes.",
      "The hook can pull you across impossible jumps.",
      "Look for letter nodes above the hazards.",
      "Build words like CAT, FROST, or DREAM to hook across!"
    ];

    const randomGuidance = Phaser.Utils.Array.GetRandom(guidance);
    this.jumufGiveHint(randomGuidance);
  }

  /**
   * Check if player should receive hook guidance (called periodically)
   */
  private hookGuidanceFrameCounter = 0;
  private checkForHookGuidanceNeeded() {
    // Throttle: only check every 360 frames (~6 seconds at 60fps) to avoid
    // expensive distance calculations on 50+ letter nodes every single frame
    this.hookGuidanceFrameCounter++;
    if (this.hookGuidanceFrameCounter < 360) return;
    this.hookGuidanceFrameCounter = 0;

    if (this.isTraversing) return;
    if (this.jumufHintBubble) return;

    // Check if player is near any letter node
    const px = this.player.x;
    const py = this.player.y;
    let nearNode = false;
    for (let i = 0; i < this.letters.length; i++) {
      const letter = this.letters[i];
      const dx = px - letter.x;
      const dy = py - letter.y;
      if (dx * dx + dy * dy < 90000) { // 300^2
        nearNode = true;
        break; // Early exit - only need to know if ANY node is near
      }
    }

    if (nearNode) {
      this.giveDjinnHookGuidance();
    }
  }

  // ========== AIR SUSPENSION SYSTEM ==========
  /**
   * Start 15-second air suspension after hooking to node
   * Player floats in air and can click next node
   * After 10 seconds: Flash nearby letters purple as hint
   * After 15 seconds: Safely drop if no action taken
   */
  private startAirSuspension(
    x: number,
    y: number,
    landingY: number,
    collectedLetter: string,
    letterNode: Phaser.GameObjects.Text
  ) {
    // Mark as suspended
    this.isSuspended = true;
    this.suspensionStartTime = this.time.now;
    this.hintFlashActive = false;

    // Store references for click-to-drop mechanic
    this.currentSuspendedNode = letterNode;
    this.suspensionLandingY = landingY;

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Position player at node location (suspended in air)
    body.enable = true;
    body.setAllowGravity(false); // No gravity while suspended
    this.player.setPosition(x, y);
    body.setVelocity(0, 0);

    // Player can interact but is still "traversing" (prevents manual movement)
    this.isTraversing = false; // Allow clicking other nodes
    this.manualControlEnabled = false; // But disable WASD movement

    // Floating animation (gentle bobbing)
    this.tweens.add({
      targets: this.player,
      y: y - 10,
      duration: 1500,
      yoyo: true,
      repeat: 7, // Repeat for full suspension duration (10s)
      ease: 'Sine.inOut'
    });

    // Visual indicator - glowing aura around player
    const suspensionGlow = this.add.circle(x, y, 40, 0x60a5fa, 0.3);
    suspensionGlow.setDepth(4);

    // Store glow effect reference
    this.suspensionGlowEffect = suspensionGlow;

    this.tweens.add({
      targets: suspensionGlow,
      alpha: 0.6,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 1000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut'
    });

    // Update checkpoint and show letters
    this.updateCheckpointPosition(x, landingY);
    this.checkSpellWordCompletion(collectedLetter);
    this.updateCollectedLettersDisplay();

    this.emitSpark(x, y);

    // Clear any existing suspension timer
    if (this.suspensionTimer) {
      this.suspensionTimer.remove();
    }

    // Timer for 8-second hint (flash purple)
    this.time.delayedCall(8000, () => {
      if (this.isSuspended) {
        this.flashNearbyLettersPurple();
        this.jumufGiveHint('Try connecting to nearby letters!');
      }
    });

    // Timer for 10-second drop
    this.suspensionTimer = this.time.delayedCall(10000, () => {
      if (this.isSuspended) {
        this.endAirSuspension();
      }
    });
  }

  /**
   * End air suspension - drop player safely to platform
   */
  private endAirSuspension() {
    this.isSuspended = false;
    this.hintFlashActive = false;

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Stop floating animation
    this.tweens.killTweensOf(this.player);

    // Destroy glow effect
    if (this.suspensionGlowEffect) {
      this.tweens.killTweensOf(this.suspensionGlowEffect);
      this.suspensionGlowEffect.destroy();
      this.suspensionGlowEffect = undefined;
    }

    // Use stored landing Y position
    const landingY = this.suspensionLandingY;

    // Animate safe drop to platform
    this.tweens.add({
      targets: this.player,
      y: landingY,
      duration: 500,
      ease: 'Cubic.out',
      onComplete: () => {
        // Re-enable gravity and movement
        body.setAllowGravity(true);
        body.setVelocity(0, 0);
        this.manualControlEnabled = true;

        this.emitSpark(this.player.x, landingY);
      }
    });

    // Clear references
    this.currentSuspendedNode = undefined;
    this.suspensionLandingY = 0;
  }

  /**
   * Land player immediately without air suspension
   * Used when word is complete - player drops to platform right away
   */
  private landPlayerImmediately(x: number, landingY: number) {
    // Make sure we're not suspended
    this.isSuspended = false;
    this.hintFlashActive = false;

    const body = this.player.body as Phaser.Physics.Arcade.Body;

    // Stop any floating animations
    this.tweens.killTweensOf(this.player);

    // Destroy glow effect if exists
    if (this.suspensionGlowEffect) {
      this.tweens.killTweensOf(this.suspensionGlowEffect);
      this.suspensionGlowEffect.destroy();
      this.suspensionGlowEffect = undefined;
    }

    // Quick drop animation to landing position
    this.tweens.add({
      targets: this.player,
      y: landingY,
      duration: 300, // Faster than normal drop
      ease: 'Cubic.out',
      onComplete: () => {
        // Re-enable gravity and movement
        body.enable = true;
        body.setAllowGravity(true);
        body.setVelocity(0, 0);
        this.isTraversing = false;
        this.manualControlEnabled = true;

        this.emitSpark(x, landingY);

        // Show "You can now exit!" message
        this.showZoneCompleteExitMessage();
      }
    });

    // Clear references
    this.currentSuspendedNode = undefined;
    this.suspensionLandingY = 0;
  }

  /**
   * Show message that player can now exit the zone
   */
  private showZoneCompleteExitMessage() {
    const exitText = this.add.text(
      this.player.x,
      this.player.y - 60,
      '✓ Word Complete!\nYou can exit now!',
      {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#22c55e',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      }
    );
    exitText.setOrigin(0.5);
    exitText.setDepth(2000);

    // Fade out and destroy
    this.tweens.add({
      targets: exitText,
      alpha: 0,
      y: exitText.y - 40,
      duration: 2000,
      onComplete: () => exitText.destroy(),
    });
  }

  /**
   * Flash nearby letters purple as hint (after 10 seconds suspended)
   */
  private flashNearbyLettersPurple() {
    this.hintFlashActive = true;

    // Find nearby uncollected letters
    const nearbyLetters = this.letters.filter(letter => {
      if (!letter.active) return false; // Skip collected letters

      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        letter.x, letter.y
      );
      return dist < 250; // Within 250px
    });

    // Flash each nearby letter purple
    nearbyLetters.forEach(letter => {
      const circle = letter.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;

      if (circle) {
        // Purple flash animation (repeating)
        const flashTween = this.tweens.add({
          targets: circle,
          fillColor: { from: circle.fillColor, to: 0xa855f7 }, // Purple
          duration: 500,
          yoyo: true,
          repeat: 10, // Flash for 5 seconds
          ease: 'Sine.inOut'
        });

        // Store tween so we can stop it when suspension ends
        letter.setData('hintFlash', flashTween);
      }

      // Also flash the letter text
      this.tweens.add({
        targets: letter,
        scale: 1.3,
        duration: 500,
        yoyo: true,
        repeat: 10,
        ease: 'Sine.inOut'
      });
    });
  }

  /**
   * Cancel air suspension early (when player clicks another node)
   */
  /**
   * Check if player is in a hook-disabled zone
   */
  private isInHookDisabledZone(playerX: number): { startX: number; endX: number; name: string } | null {
    for (const zone of this.hookDisabledZones) {
      if (playerX >= zone.startX && playerX <= zone.endX) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Show feedback when hook is disabled in current zone
   */
  private showHookDisabledFeedback(zoneName: string) {
    // Create warning message
    const warningText = this.add.text(
      this.player.x,
      this.player.y - 60,
      '🚫 Hook Disabled\nUse WASD to move',
      {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#ff6b6b',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center'
      }
    ).setOrigin(0.5).setDepth(1000);

    // Animate warning
    this.tweens.add({
      targets: warningText,
      y: this.player.y - 80,
      alpha: 0,
      duration: 1500,
      ease: 'Power2.easeOut',
      onComplete: () => warningText.destroy()
    });

    // Flash player red briefly
    this.player.setTint(0xff0000);
    this.time.delayedCall(200, () => {
      this.player.clearTint();
    });

    // Show zone name hint from Djinn
    this.jumufGiveHint(`You're in a ${zoneName}. Use arrow keys or WASD to move!`);
  }

  private cancelAirSuspension() {
    if (!this.isSuspended) return;

    // Clear timers
    if (this.suspensionTimer) {
      this.suspensionTimer.remove();
      this.suspensionTimer = undefined;
    }

    // CRITICAL: Stop the floating animation on the player
    // This prevents the old tween from conflicting with new traversal
    this.tweens.killTweensOf(this.player);

    // Destroy glow effect
    if (this.suspensionGlowEffect) {
      this.tweens.killTweensOf(this.suspensionGlowEffect);
      this.suspensionGlowEffect.destroy();
      this.suspensionGlowEffect = undefined;
    }

    // Stop hint flashes
    if (this.hintFlashActive) {
      this.letters.forEach(letter => {
        const flashTween = letter.getData('hintFlash');
        if (flashTween) {
          flashTween.stop();
        }

        // Also stop text scale animation
        this.tweens.killTweensOf(letter);
      });
    }

    this.isSuspended = false;
    this.hintFlashActive = false;

    // Clear references
    this.currentSuspendedNode = undefined;
    this.suspensionLandingY = 0;
  }

  private handleLetterClick(letterText: Phaser.GameObjects.Text) {
    // CHECK: If clicking the SAME node while suspended - DROP EARLY
    if (this.isSuspended && letterText === this.currentSuspendedNode) {
      this.endAirSuspension();
      return;
    }

    // Cancel air suspension if player clicks DIFFERENT node while suspended
    if (this.isSuspended) {
      this.cancelAirSuspension();
    }

    if (this.isTraversing || this.isTransitioningWords) {
      return;
    }

    const letter = letterText.getData('letter') as string;
    const targetX = letterText.getData('landingX') as number | undefined;
    const landingY = letterText.getData('landingY') as number | undefined;
    const nodeY = letterText.y; // Node's Y position (for suspension)

    if (targetX === undefined || landingY === undefined) {
      return;
    }

    // CHECK: Is player in a hook-disabled zone?
    const disabledZone = this.isInHookDisabledZone(this.player.x);
    if (disabledZone) {
      this.showHookDisabledFeedback(disabledZone.name);
      return;
    }

    // ========== HOOK ZONE UNIVERSAL LOGIC ==========
    // Inside hook zones: ALWAYS allow traversal, bypass sequence validation
    // This is CRITICAL for word-agnostic behavior
    if (this.isInHookZone && this.currentHookZoneIndex >= 0) {
      // Check if this zone is already solved
      // ALWAYS show valid hook animation in hook zones
      this.showHookAnimation(targetX, letterText.y, true);

      // Show valid feedback
      this.showValidFeedback(letterText);

      // Collect the letter for this zone (slot-based, universal)
      this.collectHookZoneLetter(letter);

      // Check if word is NOW complete after collecting this letter
      const targetWord = this.hookZoneTargetWord || '';
      const slotState = this.hookZoneSlotState || [];

      const allSlotsFilled = targetWord.length > 0 &&
                             slotState.length === targetWord.length &&
                             slotState.every(filled => filled);
      const allLettersCorrect = allSlotsFilled &&
                                this.hookZoneFilledLetters.every((l, i) => l === targetWord[i]);
      const isWordComplete = allLettersCorrect ||
                             (this.currentHookZoneIndex >= 0 && this.hookZoneSolved[this.currentHookZoneIndex]);

      // Mark letter as collected visually
      letterText.setTint(0x10b981); // Green tint
      const circle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;
      if (circle) {
        circle.setAlpha(0.4);
      }
      letterText.disableInteractive();

      const body = this.player.body as Phaser.Physics.Arcade.Body;

      // ===== WORD COMPLETE: INSTANT DROP TO PLATFORM =====
      if (isWordComplete) {
        // Mark zone as solved (in case it wasn't already)
        if (this.currentHookZoneIndex >= 0) {
          this.hookZoneSolved[this.currentHookZoneIndex] = true;
        }

        // Stop any existing tweens/movement
        this.tweens.killTweensOf(this.player);
        this.activeTraversalTween?.stop();

        // Clear suspension state
        this.isSuspended = false;
        if (this.suspensionTimer) {
          this.suspensionTimer.remove();
          this.suspensionTimer = undefined;
        }
        if (this.suspensionGlowEffect) {
          this.tweens.killTweensOf(this.suspensionGlowEffect);
          this.suspensionGlowEffect.destroy();
          this.suspensionGlowEffect = undefined;
        }

        // Emit spark at current position
        this.emitSpark(this.player.x, this.player.y);

        // Instantly position player at the landing spot
        this.player.setPosition(targetX, landingY);

        // Re-enable physics and movement immediately
        body.enable = true;
        body.setAllowGravity(true);
        body.setVelocity(0, 0);
        this.isTraversing = false;
        this.manualControlEnabled = true;

        // Visual celebration
        this.emitSpark(targetX, landingY);

        // Update the UI to show completion
        this.updateHookZoneUI();

        // Show exit message
        this.showZoneCompleteExitMessage();

        return; // Exit - word complete, player landed
      }

      // ===== WORD NOT COMPLETE: Normal traversal with suspension =====
      this.isTraversing = true;
      this.manualControlEnabled = false;

      body.stop();
      body.setAllowGravity(false);
      body.enable = false;

      const startX = this.player.x;
      const startY = this.player.y;

      this.activeTraversalTween?.stop();
      this.activeTraversalTween = this.tweens.add({
        targets: this.player,
        x: targetX,
        duration: 900,
        ease: Phaser.Math.Easing.Sine.InOut,
        onStart: () => this.emitSpark(startX, startY),
        onUpdate: (tween) => {
          const progress = tween.progress;
          const baseY = Phaser.Math.Linear(startY, landingY, progress);
          this.player.y = baseY - Math.sin(progress * Math.PI) * 80;

          // Particle trail during traversal
          if (progress > 0.1 && progress < 0.9 && Math.random() > 0.7) {
            this.emitTrailParticle(this.player.x, this.player.y);
          }
        },
        onComplete: () => {
          // Start air suspension at the node (word not complete yet)
          this.startAirSuspension(targetX, nodeY, landingY, letter, letterText);
        },
      });

      return; // Exit - hook zone logic complete
    }
    // ========== END HOOK ZONE LOGIC ==========

    // ========== SPECIAL: First letter of hook zone hookable from OUTSIDE ==========
    if (!this.isInHookZone) {
      const clickedNodeIndex = letterText.getData('index') as number;
      const isHookZoneNode = letterText.getData('isRequired') as boolean;

      if (isHookZoneNode && clickedNodeIndex !== undefined) {
        const clickedZoneIndex = Math.floor(clickedNodeIndex / 10);
        const clickedLetterIndex = clickedNodeIndex % 10;

        if (clickedLetterIndex === 0 &&
            clickedZoneIndex >= 0 &&
            clickedZoneIndex < this.hookZoneDefinitions.length &&
            !this.hookZoneSolved[clickedZoneIndex]) {

          // Mark as pre-collected for when player enters zone
          this.hookZoneFirstLetterPreCollected[clickedZoneIndex] = true;

          // Show hook animation and valid feedback
          this.showHookAnimation(targetX, letterText.y, true);
          this.showValidFeedback(letterText);

          // Mark letter as collected visually
          letterText.setTint(0x10b981);
          const nodeCircle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;
          if (nodeCircle) nodeCircle.setAlpha(0.4);
          letterText.disableInteractive();

          // Hook traversal to the letter node
          this.isTraversing = true;
          this.manualControlEnabled = false;

          const body = this.player.body as Phaser.Physics.Arcade.Body;
          body.stop();
          body.setAllowGravity(false);
          body.enable = false;

          const startX = this.player.x;
          const startY = this.player.y;

          this.activeTraversalTween?.stop();
          this.activeTraversalTween = this.tweens.add({
            targets: this.player,
            x: targetX,
            duration: 900,
            ease: Phaser.Math.Easing.Sine.InOut,
            onStart: () => this.emitSpark(startX, startY),
            onUpdate: (tween) => {
              const progress = tween.progress;
              const baseY = Phaser.Math.Linear(startY, landingY, progress);
              this.player.y = baseY - Math.sin(progress * Math.PI) * 80;
              if (progress > 0.1 && progress < 0.9 && Math.random() > 0.7) {
                this.emitTrailParticle(this.player.x, this.player.y);
              }
            },
            onComplete: () => {
              // Start air suspension at the node
              this.startAirSuspension(targetX, nodeY, landingY, letter, letterText);
            },
          });

          return; // Don't fall through to normal outside-zone handling
        }
      }
    }
    // ========== END FIRST LETTER SPECIAL CASE ==========

    // Outside hook zones: Use original sequence validation
    const newSequence = this.currentSequence + letter;

    // Validate the new sequence
    const isValid = this.isValidSequence(newSequence);

    // Show hook animation regardless
    this.showHookAnimation(targetX, letterText.y, isValid);

    if (!isValid) {
      // INVALID SEQUENCE - Hook fails safely
      this.showInvalidFeedback(letterText);

      // Update display to show failed attempt
      this.updateSequenceDisplay();

      return; // Do NOT move the player
    }

    // VALID SEQUENCE - Hook succeeds!

    // Update sequence
    this.currentSequence = newSequence;

    // Update the visual sequence display
    this.updateSequenceDisplay();

    // Show valid feedback
    this.showValidFeedback(letterText);

    // Add letter to collected letters
    this.collectedLetters.push(letter);

    // Update hook zone UI if in a hook zone
    this.onHookZoneLetterCollected(letter);

    // Mark letter as collected (tint green to show success)
    letterText.setTint(0x10b981); // Green tint for valid

    // Dim the node circle to show it's collected
    const circle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;
    if (circle) {
      circle.setAlpha(0.4); // Dim collected nodes
    }

    // Remove interactivity so it can't be collected again
    letterText.disableInteractive();

    // Check if we completed a full word
    if (this.validWords.includes(newSequence.toUpperCase()) &&
        newSequence.length >= 4) { // Only reset on meaningful words
      const isSpell = this.isSpellWord(newSequence);

      if (isSpell) {
        // Special feedback for spell words
        this.jumufGiveHint(`Spell word "${newSequence}" unlocked! Use it to cast spells!`);

        // Extra particle effects for spell completion
        for (let i = 0; i < 10; i++) {
          this.time.delayedCall(i * 50, () => {
            this.emitSpark(this.player.x + Phaser.Math.Between(-30, 30), this.player.y + Phaser.Math.Between(-30, 30));
          });
        }
      }

      // Reset sequence after completing a word
      this.time.delayedCall(1000, () => {
        this.currentSequence = '';

        // Clear sequence display
        if (this.sequenceDisplayText) {
          this.sequenceDisplayText.destroy();
          this.sequenceDisplayText = undefined;
        }
      });
    }

    // Spawn checkpoint flag after first letter is collected
    if (!this.firstLetterCollected) {
      this.firstLetterCollected = true;
      this.spawnCheckpointFlag(targetX, landingY);
    }

    // HOOK TRAVERSAL - Pull player to node
    this.isTraversing = true;
    this.manualControlEnabled = false;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.stop();
    body.setAllowGravity(false);
    body.enable = false;

    const startX = this.player.x;
    const startY = this.player.y;

    this.activeTraversalTween?.stop();
    this.activeTraversalTween = this.tweens.add({
      targets: this.player,
      x: targetX,
      duration: 900,
      ease: Phaser.Math.Easing.Sine.InOut,
      onStart: () => this.emitSpark(startX, startY),
      onUpdate: (tween) => {
        const progress = tween.progress;
        const baseY = Phaser.Math.Linear(startY, landingY, progress);
        this.player.y = baseY - Math.sin(progress * Math.PI) * 80;

        // Particle trail during traversal
        if (progress > 0.1 && progress < 0.9 && Math.random() > 0.7) {
          this.emitTrailParticle(this.player.x, this.player.y);
        }
      },
      onComplete: () => {
        // INSTEAD OF LANDING: Start air suspension (10 seconds)
        this.startAirSuspension(targetX, nodeY, landingY, letter, letterText);
      },
    });
  }

  private checkSpellWordCompletion(newLetter: string) {
    let letterWasUseful = false;
    
    // Check each incomplete word to see if this letter completes it
    this.incompleteWords.forEach((wordData, index) => {
      if (wordData.missingLetters.includes(newLetter)) {
        letterWasUseful = true;
        // Remove the found letter from missing letters
        wordData.missingLetters = wordData.missingLetters.filter(letter => letter !== newLetter);
        
        // Check if word is now complete
        if (wordData.missingLetters.length === 0) {
          console.log(`✨ SPELL WORD COMPLETED: ${wordData.word}!`);
          
          // Add to completed spell words
          this.completedSpellWords.push(wordData.word);
          
          // Remove from incomplete words
          this.incompleteWords.splice(index, 1);
          
          // Show completion effect
          this.showSpellWordCompleted(wordData.word);
        }
      }
    });

    // Track incorrect letter selection (wrong traversal click)
    if (!letterWasUseful && this.incompleteWords.length > 0) {
      this.traversalMistakes++;
      console.log(`⚠️ Incorrect letter selection. Mistakes: ${this.traversalMistakes}`);
      
      // If 3 incorrect attempts, show Jumuf with hint
      if (this.traversalMistakes >= 3) {
        // Find a word that needs help (prefer FROST if available)
        const wordNeedingHelp = this.incompleteWords.find(w => w.word === 'FROST') || this.incompleteWords[0];
        if (wordNeedingHelp) {
          const hintText = `hmmm....the word you might want is ${this.getWordHint(wordNeedingHelp.word)}....?`;
          this.jumufGiveHint(hintText);
          this.traversalMistakes = 0; // Reset counter
        }
      }
    } else if (letterWasUseful) {
      // Reset mistakes if correct letter was selected
      this.traversalMistakes = 0;
    }
    
    // Update UI
    this.updateWordUI();
  }

  private getWordHint(word: string): string {
    // Return a descriptive hint for the word
    const hints: { [key: string]: string } = {
      'FROST': 'cold',
      'BLAZE': 'fire',
      'STORM': 'thunder',
      'BLIND': 'darkness',
      'HUNGRY': 'empty'
    };
    return hints[word] || word.toLowerCase();
  }

  private showSpellWordCompleted(word: string) {
    // Create completion effect
    const completionText = this.add.text(400, 150, `✨ ${word} SPELL LEARNED! ✨`, {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffd700',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);
    
    // Animate completion text
    completionText.setScale(0);
    this.tweens.add({
      targets: completionText,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.time.delayedCall(2000, () => {
          this.tweens.add({
            targets: completionText,
            alpha: 0,
            scale: 1.5,
            duration: 500,
            ease: 'Power2.easeIn',
            onComplete: () => completionText.destroy()
          });
        });
      }
    });
    
    // Screen flash
    this.cameras.main.flash(400, 255, 215, 0, false);
    
    console.log(`🎤 "${word}" is now available for voice attacks! Press V and say "${word}"`);
    
    // Launch huge frost attack when FROST is completed
    if (word === 'FROST') {
      this.time.delayedCall(500, () => {
        this.launchHugeFrostAttack();
      });
    }
  }

  private updateCollectedLettersDisplay() {
    // ========== DISABLED: "Collected:" UI removed per design requirements ==========
    // Only the hook zone hangman-style UI should show word progress
    // This global "Collected:" display is no longer needed

    console.log(`Collected letters: ${this.collectedLetters.join(', ')}`);

    // Destroy any existing text (cleanup)
    if (this.collectedLettersText) {
      this.collectedLettersText.destroy();
      this.collectedLettersText = undefined;
    }
    // DO NOT create new text - the hook zone UI handles word display
  }

  private collectedLettersText?: Phaser.GameObjects.Text;
  private sequenceDisplayText?: Phaser.GameObjects.Text;

  private setupIncompleteWords() {
    // Define incomplete words with missing letters
    this.incompleteWords = [
      {
        word: 'FROST',
        missingLetters: ['O', 'S'], // Missing O and S
        foundLetters: ['F', 'R', 'T'] // Already have F, R, T
      },
      {
        word: 'BLAZE',
        missingLetters: ['L', 'E'], // Missing L and E
        foundLetters: ['B', 'A', 'Z'] // Already have B, A, Z
      },
      {
        word: 'STORM',
        missingLetters: ['T', 'M'], // Missing T and M
        foundLetters: ['S', 'O', 'R'] // Already have S, O, R
      },
      {
        word: 'BLIND',
        missingLetters: ['B', 'N'], // Missing B and N
        foundLetters: ['L', 'I', 'D'] // Already have L, I, D
      },
      {
        word: 'HUNGRY',
        missingLetters: ['H', 'G', 'Y'], // Missing H, G, Y
        foundLetters: ['U', 'N', 'R'] // Already have U, N, R
      }
    ];
    
    console.log('📝 Incomplete words setup:', this.incompleteWords);
  }

  private createWordUI() {
    // ========== GLOBAL SPELLS UI - PERMANENTLY DISABLED ==========
    // This UI is disabled per design requirements.
    // Word UI now only appears inside hook-mandatory zones.
    // The container is created but immediately hidden and never shown.

    this.wordUIContainer = this.add.container(0, 0).setDepth(2000).setScrollFactor(0);

    // Create background panel (hidden)
    const panelWidth = 760;
    const panelHeight = 50;
    const panel = this.add.rectangle(400, 25, panelWidth, panelHeight, 0x1a1a2e, 0.85)
      .setStrokeStyle(1, 0x60a5fa);
    this.wordUIContainer.add(panel);

    const title = this.add.text(40, 10, 'SPELLS:', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#60a5fa',
      stroke: '#000000',
      strokeThickness: 1,
    });
    this.wordUIContainer.add(title);

    // PERMANENTLY HIDE - Global spell UI is disabled
    // Word tracking now happens only in hook zones
    this.wordUIContainer.setVisible(false);
    this.wordUIContainer.setActive(false);
  }

  private updateWordUI() {
    if (!this.wordUIContainer) return;
    
    // Clear existing word displays (keep panel and title)
    const children = this.wordUIContainer.list.slice();
    children.forEach((child, index) => {
      if (index > 1) { // Keep panel (0) and title (1)
        this.wordUIContainer!.remove(child);
        child.destroy();
      }
    });
    
    // Display incomplete words in a clean row
    let xOffset = 120;
    const yOffset = 25;
    
    this.incompleteWords.forEach((wordData, index) => {
      // Create clean word display
      const wordText = this.createCleanWordDisplay(wordData, xOffset, yOffset);
      this.wordUIContainer!.add(wordText);
      
      xOffset += 120; // Tighter spacing between words
    });
    
    // Display completed spell words - more compact
    if (this.completedSpellWords.length > 0) {
      const completedText = this.add.text(xOffset, 25, `✓ ${this.completedSpellWords.join(' ')}`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#22c55e',
        stroke: '#000000',
        strokeThickness: 1,
      });
      this.wordUIContainer!.add(completedText);
    }
  }

  private createCleanWordDisplay(wordData: { word: string; missingLetters: string[]; foundLetters: string[] }, x: number, y: number): Phaser.GameObjects.Text {
    // Create clean word display with color coding
    let displayText = '';
    
    for (const letter of wordData.word) {
      if (wordData.foundLetters.includes(letter)) {
        displayText += letter; // Show found letters
      } else {
        displayText += '_'; // Show blanks for missing letters
      }
    }
    
    // Create single text display - clean and simple
    const text = this.add.text(x, y, displayText, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 1,
    });
    
    return text;
  }

  private spawnCheckpointFlag(x: number, y: number) {
    // Create checkpoint flag texture if it doesn't exist
    if (!this.textures.exists('checkpoint_flag')) {
      const g = this.add.graphics();
      
      // Flag pole (brown)
      g.fillStyle(0x8b4513, 1);
      g.fillRect(14, 0, 4, 32);
      
      // Flag (red with white cross or pattern)
      g.fillStyle(0xdc2626, 1);
      g.fillRect(0, 2, 16, 12);
      
      // Flag pattern (white)
      g.fillStyle(0xffffff, 1);
      g.fillRect(2, 4, 12, 2);
      g.fillRect(2, 8, 12, 2);
      
      // Flag shadow
      g.fillStyle(0x991b1b, 1);
      g.fillRect(0, 12, 16, 2);
      
      g.generateTexture('checkpoint_flag', 18, 32);
      g.destroy();
    }

    // Remove existing flag if any
    if (this.checkpointFlag) {
      this.checkpointFlag.destroy();
    }

    // Create new checkpoint flag
    this.checkpointFlag = this.add.image(x + 25, y - 40, 'checkpoint_flag')
      .setOrigin(0.5, 1)
      .setDepth(15);

    // Add waving animation to flag
    this.tweens.add({
      targets: this.checkpointFlag,
      scaleX: 0.9,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Add floating animation
    this.tweens.add({
      targets: this.checkpointFlag,
      y: (y - 40) - 5,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    console.log(`🚩 Checkpoint flag spawned at (${x + 25}, ${y - 40})`);
    
    // Show checkpoint activation message
    const checkpointText = this.add.text(
      x,
      y - 80,
      '🚩 CHECKPOINT ACTIVE!',
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#22c55e',
        stroke: '#000000',
        strokeThickness: 3,
      }
    )
    .setOrigin(0.5)
    .setDepth(100);

    // Animate checkpoint text
    this.tweens.add({
      targets: checkpointText,
      y: y - 120,
      alpha: 0,
      duration: 2000,
      ease: 'Sine.easeOut',
      onComplete: () => checkpointText.destroy(),
    });
  }

  private updateCheckpointPosition(x: number, y: number) {
    // Update checkpoint position to current platform
    this.checkpointPosition = new Phaser.Math.Vector2(x, y);
    this.checkpointReached = true;
    
    // Move flag to current position
    if (this.checkpointFlag) {
      this.tweens.add({
        targets: this.checkpointFlag,
        x: x + 25,
        y: y - 40,
        duration: 500,
        ease: 'Power2.easeOut'
      });
    }
    
    console.log(`🚩 Checkpoint updated to (${x}, ${y})`);
  }

  private showWrongLetterFeedback() {
    // Flash screen red
    this.cameras.main.flash(200, 255, 0, 0, false, (_, progress) => {
      if (progress === 1) {
        this.cameras.main.shake(100, 0.005);
      }
    });
  }

  private emitTrailParticle(x: number, y: number) {
    const particle = this.add.rectangle(x, y, 4, 4, 0xfff07a, 0.8).setDepth(11);
    this.tweens.add({
      targets: particle,
      alpha: 0,
      scale: 0.3,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => particle.destroy(),
    });
  }

  private resetTraversalState() {
    this.activeTraversalTween?.stop();
    this.activeTraversalTween = undefined;
    this.isTraversing = false;
    this.manualControlEnabled = true;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.setAllowGravity(true);
    body.setVelocity(0, 0);
  }

  private emitSpark(x: number, y: number) {
    for (let i = 0; i < 4; i++) {
      const spark = this.add.rectangle(x, y, 6, 6, 0xfff07a).setDepth(11);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dist = Phaser.Math.Between(10, 25);
      const tx = x + Math.cos(angle) * dist;
      const ty = y + Math.sin(angle) * dist;
      this.tweens.add({
        targets: spark,
        x: tx,
        y: ty,
        alpha: 0,
        scale: 0.2,
        duration: 250,
        ease: 'Quad.easeOut',
        onComplete: () => spark.destroy(),
      });
    }
  }

  private reachWordGoal() {
    console.log(`Word complete: ${this.currentWord}`);
    this.isTransitioningWords = true;
    this.manualControlEnabled = false;

    // Add completed word to voice recognition list
    this.completedWords.push(this.currentWord);
    console.log(`🎤 Word "${this.currentWord}" added to voice commands. Say it to cast spell!`);

    // Activate checkpoint after first word (BLAZE)
    if (this.currentWordIndex === 0 && !this.checkpointReached) {
      this.activateCheckpoint();
    }

    // Blaze effect for word completion
    this.cameras.main.flash(300, 255, 215, 0, false);
    this.spawnDust(this.player.x, this.player.y + this.player.height / 2);
    
    // Create burst effect
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dist = 40;
      const particle = this.add.rectangle(
        this.player.x,
        this.player.y,
        8,
        8,
        0xfff07a
      ).setDepth(11);
      
      this.tweens.add({
        targets: particle,
        x: this.player.x + Math.cos(angle) * dist,
        y: this.player.y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: 400,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }

    // Fade out letters
    this.letters.forEach((letter, idx) => {
      this.tweens.add({
        targets: letter,
        alpha: 0,
        scale: 0.5,
        duration: 300,
        delay: idx * 50,
        ease: 'Back.easeIn',
        onComplete: () => {
          if (idx === this.letters.length - 1) {
            // All letters faded, load next word
            this.time.delayedCall(500, () => {
              this.currentWordIndex++;
              this.loadNextWord();
              this.manualControlEnabled = true;
            });
          }
        },
      });
    });
  }

  private reachAllGoals() {
    console.log('All words complete!');
    this.isTransitioningWords = false;
    this.manualControlEnabled = false;

    // Clear any remaining letters and node circles
    this.letters.forEach((letter) => letter.destroy());
    this.letters = [];
    this.nodeCircles.forEach((circle) => circle.destroy());
    this.nodeCircles = [];

    // Big celebration effect
    this.cameras.main.shake(200, 0.008);
    this.cameras.main.flash(400, 100, 255, 100, false);
    
    // Multiple particle bursts
    for (let burst = 0; burst < 3; burst++) {
      this.time.delayedCall(burst * 150, () => {
        this.spawnDust(this.player.x, this.player.y + this.player.height / 2);
        
        for (let i = 0; i < 12; i++) {
          const angle = (i / 12) * Math.PI * 2;
          const dist = 60 + burst * 20;
          const particle = this.add.rectangle(
            this.player.x,
            this.player.y,
            10,
            10,
            Phaser.Display.Color.HSVToRGB(i / 12, 1, 1).color
          ).setDepth(11);
          
          this.tweens.add({
            targets: particle,
            x: this.player.x + Math.cos(angle) * dist,
            y: this.player.y + Math.sin(angle) * dist,
            alpha: 0,
            scale: 0.2,
            duration: 500,
            ease: 'Quad.easeOut',
            onComplete: () => particle.destroy(),
          });
        }
      });
    }

    // Zoom effect
    this.cameras.main.zoomTo(1.15, 300, 'Sine.easeOut', true, (_, progress) => {
      if (progress === 1) {
        this.cameras.main.zoomTo(1, 300, 'Sine.easeIn', true);
      }
    });

    // Launch completion UI
    this.time.delayedCall(800, () => {
      this.scene.launch('UIScene', { word: 'LEVEL COMPLETE' });
      this.scene.pause();
    });
  }

  private updateMovingHazards(_: number) {
    this.movingHazards.forEach((hazard) => {
      const { shape, glow, body, axis, min, max, speed } = hazard;
      if (axis === 'x') {
        if (shape.x <= min && body.velocity.x < 0) {
          body.setVelocityX(Math.abs(speed));
        } else if (shape.x >= max && body.velocity.x > 0) {
          body.setVelocityX(-Math.abs(speed));
        }
      } else {
        if (shape.y <= min && body.velocity.y < 0) {
          body.setVelocityY(Math.abs(speed));
        } else if (shape.y >= max && body.velocity.y > 0) {
          body.setVelocityY(-Math.abs(speed));
        }
      }

      if (glow?.active) {
        glow.setPosition(shape.x, shape.y);
      }
    });
  }

  private updateEnemies() {
    this.enemies.forEach((enemy) => {
      const { sprite, body, patrolMin, patrolMax, speed } = enemy;
      
      // Update ice block position if frozen
      if (sprite.getData('isFrozen')) {
        const iceBlock = sprite.getData('iceBlock');
        if (iceBlock && iceBlock.active) {
          iceBlock.setPosition(sprite.x, sprite.y);
        }
      }
      
      // Update fire effect position if scorched
      if (sprite.getData('isScorched')) {
        const fireEffect = sprite.getData('fireEffect');
        if (fireEffect && fireEffect.active) {
          fireEffect.setPosition(sprite.x, sprite.y - 10);
        }
      }
      
      // Update lightning bolt position if paralyzed
      if (sprite.getData('isParalyzed')) {
        const lightningBolt = sprite.getData('lightningBolt');
        if (lightningBolt && lightningBolt.active) {
          lightningBolt.setPosition(sprite.x, sprite.y - 15);
        }
      }
      
      // Reverse direction at patrol boundaries
      if (sprite.x <= patrolMin && body.velocity.x < 0) {
        body.setVelocityX(Math.abs(speed));
        sprite.setFlipX(false);
      } else if (sprite.x >= patrolMax && body.velocity.x > 0) {
        body.setVelocityX(-Math.abs(speed));
        sprite.setFlipX(true);
      }
    });
  }

  private spawnDust(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const puff = this.add.rectangle(x, y, 8, 8, 0xffffff, 0.4);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(10, 28);
      const tx = x + Math.cos(angle) * distance;
      const ty = y + Math.sin(angle) * distance;

      this.tweens.add({
        targets: puff,
        x: tx,
        y: ty,
        scale: 0.2,
        alpha: 0,
        duration: 350,
        ease: 'Sine.easeOut',
        onComplete: () => puff.destroy(),
      });
    }
  }

  private addLandingSquash() {
    this.tweens.add({
      targets: this.player,
      scaleY: 0.85,
      duration: 80,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private goalReached() {
    this.isTraversing = false;
    this.manualControlEnabled = false;

    this.cameras.main.shake(150, 0.003);
    this.spawnDust(this.player.x, this.player.y + this.player.height / 2);

    this.cameras.main.zoomTo(1.15, 250, 'Sine.easeOut', true, (_, progress) => {
      if (progress === 1) {
        this.cameras.main.zoomTo(1, 250, 'Sine.easeIn', true);
      }
    });

    this.scene.launch('UIScene', { word: 'CAT' });
    this.scene.pause();
  }


  private setupVoiceRecognitionFromTest() {
    if (this.microphoneReady && this.speechRecognition) {
      // Microphone test passed, configure the existing speech recognition
      this.speechRecognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toUpperCase().trim();
        console.log(`🎤 Heard: "${transcript}"`);
        this.handleVoiceCommand(transcript);
        this.isListening = false;
      };

      this.speechRecognition.onerror = (event: any) => {
        console.log('🎤 Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          this.showMicrophoneError('Microphone access denied. Please allow microphone access and refresh.');
        } else if (event.error === 'no-speech') {
          console.log('🎤 No speech detected, try again.');
        } else if (event.error === 'network') {
          this.showMicrophoneError('Network error. Check your internet connection.');
        }
        this.isListening = false;
      };

      this.speechRecognition.onstart = () => {
        console.log('🎤 Speech recognition started');
      };

      this.speechRecognition.onend = () => {
        console.log('🎤 Speech recognition ended');
        this.isListening = false;
      };

      console.log('🎤 Voice recognition ready! Press V to cast spells with your voice.');
      this.showMicrophoneStatus('🎤 Voice spells enabled! Press V to cast completed words.');
      
      // Show initial instructions
      this.showVoiceInstructions();
    } else {
      // Microphone test failed or was skipped
      console.log('🎤 Voice recognition disabled - microphone test failed or was skipped.');
      this.showMicrophoneError('Voice spells disabled. Use keyboard controls: Arrow keys to move, Space to jump, E to attack.');
    }
  }

  private async setupVoiceRecognition() {
    // This method is kept for backward compatibility but should not be used
    // when coming from the mic test scene
    console.warn('setupVoiceRecognition called - this should use setupVoiceRecognitionFromTest instead');
    
    // First, request microphone permissions
    try {
      await this.requestMicrophonePermission();
    } catch (error) {
      console.log('🎤 Microphone permission denied:', error);
      return;
    }

    // Check if browser supports speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      this.speechRecognition = new SpeechRecognition();
      this.speechRecognition.continuous = false;
      this.speechRecognition.interimResults = false;
      this.speechRecognition.lang = 'en-US';

      this.speechRecognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toUpperCase().trim();
        console.log(`🎤 Heard: "${transcript}"`);
        this.handleVoiceCommand(transcript);
        this.isListening = false;
      };

      this.speechRecognition.onerror = (event: any) => {
        console.log('🎤 Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          this.showMicrophoneError('Microphone access denied. Please allow microphone access and refresh.');
        } else if (event.error === 'no-speech') {
          console.log('🎤 No speech detected, try again.');
        } else if (event.error === 'network') {
          this.showMicrophoneError('Network error. Check your internet connection.');
        }
        this.isListening = false;
      };

      this.speechRecognition.onstart = () => {
        console.log('🎤 Speech recognition started');
      };

      this.speechRecognition.onend = () => {
        console.log('🎤 Speech recognition ended');
        this.isListening = false;
      };

      this.microphoneReady = true;
      console.log('🎤 Voice recognition initialized! Press V to listen for spell words.');
      this.showMicrophoneStatus('🎤 Microphone ready! Press V to cast spells with your voice.');
      
      // Show initial instructions
      this.showVoiceInstructions();
    } else {
      console.log('🎤 Speech recognition not supported in this browser.');
      this.showMicrophoneError('Voice recognition not supported in this browser. Try Chrome, Edge, or Safari.');
    }
  }

  private async requestMicrophonePermission(): Promise<void> {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Stop the stream immediately (we just needed permission)
      stream.getTracks().forEach(track => track.stop());
      
      console.log('🎤 Microphone permission granted');
      return Promise.resolve();
    } catch (error) {
      console.error('🎤 Microphone permission error:', error);
      this.showMicrophoneError('Please allow microphone access to use voice spells!');
      return Promise.reject(error);
    }
  }

  private showMicrophoneStatus(message: string) {
    const statusText = this.add.text(
      400, 50,
      message,
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#22c55e',
        stroke: '#000000',
        strokeThickness: 2,
      }
    )
    .setOrigin(0.5)
    .setDepth(1000)
    .setScrollFactor(0);

    // Fade out after 4 seconds
    this.time.delayedCall(4000, () => {
      this.tweens.add({
        targets: statusText,
        alpha: 0,
        duration: 1000,
        onComplete: () => statusText.destroy(),
      });
    });
  }

  private showMicrophoneError(message: string) {
    const errorText = this.add.text(
      400, 50,
      message,
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ef4444',
        stroke: '#000000',
        strokeThickness: 2,
        wordWrap: { width: 600 }
      }
    )
    .setOrigin(0.5)
    .setDepth(1000)
    .setScrollFactor(0);

    // Stay visible longer for errors
    this.time.delayedCall(8000, () => {
      this.tweens.add({
        targets: errorText,
        alpha: 0,
        duration: 1000,
        onComplete: () => errorText.destroy(),
      });
    });
  }

  private showVoiceInstructions() {
    const instructionText = this.add.text(
      400, 100,
      'Complete words to learn spells, then press V to cast them!',
      {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#60a5fa',
        stroke: '#000000',
        strokeThickness: 2,
        wordWrap: { width: 600 }
      }
    )
    .setOrigin(0.5)
    .setDepth(1000)
    .setScrollFactor(0);

    // Fade out after 6 seconds
    this.time.delayedCall(6000, () => {
      this.tweens.add({
        targets: instructionText,
        alpha: 0,
        duration: 1500,
        onComplete: () => instructionText.destroy(),
      });
    });
  }

  private startListening(force: boolean = false) {
    if (!this.speechRecognition) {
      this.showMicrophoneError('Voice recognition not available. Please refresh and allow microphone access.');
      return;
    }

    if (this.isListening) {
      console.log('🎤 Already listening...');
      return;
    }

    if (!force && this.completedSpellWords.length === 0) {
      console.log('🎤 No spell words learned yet! Find missing letters to complete spells.');
      const noWordsText = this.add.text(
        this.player.x,
        this.player.y - 80,
        'Find missing letters to learn spells!',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#fbbf24',
          stroke: '#000000',
          strokeThickness: 3,
        }
      )
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(1);

      this.time.delayedCall(2000, () => {
        if (noWordsText.active) {
          noWordsText.destroy();
        }
      });
      return;
    }

    try {
      this.isListening = true;
      this.speechRecognition.start();
      
      // Show listening indicator
      const listeningText = this.add.text(
        this.player.x,
        this.player.y - 80,
        '🎤 LISTENING...',
        {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#60a5fa',
          stroke: '#000000',
          strokeThickness: 3,
        }
      )
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(1);

      // Show available spells
      const availableSpells = this.completedSpellWords.length > 0 
        ? this.completedSpellWords.join(', ')
        : 'No spells learned yet';
      
      const spellsText = this.add.text(
        this.player.x,
        this.player.y - 50,
        `Say: ${availableSpells}`,
        {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#9ca3af',
          stroke: '#000000',
          strokeThickness: 2,
        }
      )
      .setOrigin(0.5)
      .setDepth(100)
      .setScrollFactor(1);

      // Remove listening text after 5 seconds (increased timeout)
      this.time.delayedCall(5000, () => {
        if (listeningText.active) {
          listeningText.destroy();
        }
        if (spellsText.active) {
          spellsText.destroy();
        }
        if (this.isListening) {
          this.speechRecognition.stop();
        }
      });

    } catch (error) {
      console.error('🎤 Error starting speech recognition:', error);
      this.showMicrophoneError('Failed to start voice recognition. Try again.');
      this.isListening = false;
    }
  }

  private handleVoiceCommand(spokenWord: string) {
    // Normalize the spoken word
    const normalizedSpoken = spokenWord.toUpperCase().trim();
    
    // Emit word-spoken event for PronunciationDoor system
    this.events.emit('word-spoken', normalizedSpoken);

    // Check if we're waiting for FROST pronunciation after pressing T
    if (this.waitingForFrostPronunciation) {
      if (normalizedSpoken === 'FROST' || normalizedSpoken.includes('FROST')) {
        console.log('❄️ FROST pronounced! Launching huge frost attack!');
        this.waitingForFrostPronunciation = false;
        this.launchHugeFrostAttack();
        return;
      } else {
        console.log(`❌ You said "${spokenWord}" but need to say "FROST". Try again by pressing T.`);
        this.waitingForFrostPronunciation = false;
        this.showMicrophoneError('Say "FROST" to launch the attack!');
        return;
      }
    }

    // Check if spoken word matches any completed spell words
    // Prioritize exact matches, then check for word boundaries
    let matchedWord: string | undefined = undefined;
    
    // First try exact match (case-insensitive)
    matchedWord = this.completedSpellWords.find(word => 
      normalizedSpoken === word.toUpperCase()
    );
    
    // If no exact match, try if the spoken word contains the spell word as a whole word
    // This prevents partial matches like "STORM" matching "STORM" in "STORMS"
    if (!matchedWord) {
      matchedWord = this.completedSpellWords.find(word => {
        const upperWord = word.toUpperCase();
        // Check if spoken word contains the spell word as a complete word
        const wordBoundaryRegex = new RegExp(`\\b${upperWord}\\b`, 'i');
        if (wordBoundaryRegex.test(normalizedSpoken)) {
          return true;
        }
        // Also check if they're similar (for speech recognition errors)
        // Only if the lengths are similar (within 2 characters)
        if (Math.abs(normalizedSpoken.length - upperWord.length) <= 2) {
          return normalizedSpoken.includes(upperWord) || upperWord.includes(normalizedSpoken);
        }
        return false;
      });
    }

    if (matchedWord) {
      // Reset pronunciation mistakes on success
      this.pronunciationMistakes = 0;
      // Track successful pronunciation in analytics
      trackPronunciationAttempt(true);
      // Mark that player is attempting spells (for death tracking)
      this.diedDuringSpell = true;
      this.castSpell(matchedWord);
    } else {
      // Track failed pronunciation in analytics
      trackPronunciationAttempt(false);
      // Track failed spell attempt
      this.lastFailedSpell = normalizedSpoken;
      this.showSpellFailure();
    }
  }

  private startListeningForFrost() {
    if (!this.microphoneReady || !this.speechRecognition) {
      this.showMicrophoneError('Microphone not available. Enable microphone access first.');
      this.waitingForFrostPronunciation = false;
      return;
    }

    if (this.isListening) {
      this.speechRecognition.stop();
    }

    try {
      this.isListening = true;
      
      // Show instruction text
      const instructionText = this.add.text(400, 200, '🎤 Say "FROST" now!', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#87ceeb',
        stroke: '#000000',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(3000).setScrollFactor(0);

      this.tweens.add({
        targets: instructionText,
        alpha: 0.7,
        scale: 1.1,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });

      // Set up speech recognition handlers
      this.speechRecognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript.toUpperCase().trim();
        console.log(`🎤 Heard: "${transcript}"`);
        
        this.isListening = false;
        instructionText.destroy();
        this.handleVoiceCommand(transcript);
      };

      this.speechRecognition.onerror = (event: any) => {
        console.error('🎤 Speech recognition error:', event.error);
        this.isListening = false;
        instructionText.destroy();
        this.waitingForFrostPronunciation = false;
        this.showMicrophoneError('Speech recognition error. Try again.');
      };

      this.speechRecognition.onend = () => {
        if (this.isListening) {
          // Restart if still listening
          this.speechRecognition.start();
        } else {
          instructionText.destroy();
        }
      };

      this.speechRecognition.start();
      console.log('🎤 Listening for FROST pronunciation...');
    } catch (error) {
      console.error('🎤 Error starting speech recognition:', error);
      this.showMicrophoneError('Failed to start voice recognition. Try again.');
      this.isListening = false;
      this.waitingForFrostPronunciation = false;
    }
  }

  private castSpell(spellWord: string) {
    // Special handling for FROST - launch blizzard stun
    if (spellWord === 'FROST') {
      this.launchFrostBlizzardStun();
      return;
    }

    // Special handling for BLAZE - launch flare stun
    if (spellWord === 'BLAZE') {
      this.destroySnowDemonsFromSpeechBlaze();
      this.launchFlareStun();
      return;
    }

    // Special handling for STORM - launch storm stun
    if (spellWord === 'STORM') {
      this.launchStormStun();
      return;
    }

    // Special handling for HUNGRY - launch hungry stun
    if (spellWord === 'HUNGRY') {
      this.launchHungryStun();
      return;
    }

    console.log(`🔥 Casting ${spellWord} spell - AOE STUN ATTACK!`);

    // Center the AOE attack on the player
    const playerX = this.player.x;
    const playerY = this.player.y;

    // Create dramatic charging effect first
    this.createLaserChargingEffect(playerX, playerY);
    
    // Show spell word above player
    const spellText = this.add.text(
      this.player.x,
      this.player.y - 60,
      `💫 ${spellWord} STUN 💫`,
      {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#6666ff',
        stroke: '#000000',
        strokeThickness: 4,
      }
    )
    .setOrigin(0.5)
    .setDepth(100)
    .setScrollFactor(1);

    // Animate spell text
    this.tweens.add({
      targets: spellText,
      y: this.player.y - 120,
      alpha: 0,
      scale: 1.5,
      duration: 2000,
      ease: 'Sine.easeOut',
      onComplete: () => spellText.destroy(),
    });

    // Player charging animation
    this.tweens.add({
      targets: this.player,
      scaleX: 1.4,
      scaleY: 1.4,
      duration: 500,
      yoyo: true,
      ease: 'Power2.easeInOut',
    });

    // Delay before firing the AOE blast
    this.time.delayedCall(600, () => {
      this.fireLaserBeam(playerX, playerY, playerX, playerY, spellWord);
    });
  }

  private createLaserChargingEffect(x: number, y: number) {
    // Create charging energy particles
    for (let i = 0; i < 30; i++) {
      this.time.delayedCall(i * 20, () => {
        const angle = Math.random() * Math.PI * 2;
        const distance = 80 + Math.random() * 40;
        const startX = x + Math.cos(angle) * distance;
        const startY = y + Math.sin(angle) * distance;
        
        const chargeParticle = this.add.rectangle(startX, startY, 6, 6, 0x00ffff)
          .setDepth(15);
        
        // Animate particle flying toward laser origin
        this.tweens.add({
          targets: chargeParticle,
          x: x,
          y: y,
          scale: 0.2,
          duration: 400,
          ease: 'Power2.easeIn',
          onComplete: () => {
            chargeParticle.destroy();
            // Create small explosion at laser origin
            this.createSmallExplosion(x, y);
          }
        });
      });
    }

    // Screen flash during charging
    this.cameras.main.flash(600, 0, 255, 255, false);
  }

  private createSmallExplosion(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const particle = this.add.rectangle(x, y, 4, 4, 0xffffff).setDepth(15);
      
      this.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * 20,
        y: y + Math.sin(angle) * 20,
        alpha: 0,
        duration: 200,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }
  }

  private fireLaserBeam(startX: number, startY: number, endX: number, endY: number, spellWord: string) {
    console.log(`⚡ FIRING AOE ATTACK centered on player!`);

    // Create AOE visual effect centered on player
    const playerX = this.player.x;
    const playerY = this.player.y;
    const attackRadius = 10 * 32; // 320 pixels

    // Create the main AOE blast circle
    const aoeBlast = this.add.graphics().setDepth(20);
    
    // Draw AOE blast with multiple layers for effect
    this.drawAOEBlast(aoeBlast, playerX, playerY, attackRadius);

    // Create AOE blast sound effect (visual representation)
    this.cameras.main.shake(400, 0.015);

    // Animate AOE blast appearance
    aoeBlast.setAlpha(0);
    aoeBlast.setScale(0.1);
    this.tweens.add({
      targets: aoeBlast,
      alpha: 1,
      scale: 1,
      duration: 200,
      ease: 'Power2.easeOut',
      onComplete: () => {
        // Keep blast visible for a moment
        this.time.delayedCall(300, () => {
          // Fade out blast
          this.tweens.add({
            targets: aoeBlast,
            alpha: 0,
            scale: 1.2,
            duration: 300,
            ease: 'Power2.easeIn',
            onComplete: () => aoeBlast.destroy()
          });
        });
      }
    });

    // Create AOE impact effects in a circle
    this.createAOEImpactEffects(playerX, playerY, attackRadius);

    // Destroy demons hit by AOE
    this.destroyDemonsWithLaser(startX, startY, endX, endY);

    // Screen effects
    this.cameras.main.flash(400, 255, 255, 255, false);
  }

  private drawAOEBlast(graphics: Phaser.GameObjects.Graphics, centerX: number, centerY: number, radius: number) {
    graphics.clear();
    
    // Outer glow (large, transparent) - Purple/blue for stun effect
    graphics.fillStyle(0x6666ff, 0.2);
    graphics.fillCircle(centerX, centerY, radius + 40);
    
    // Middle blast (medium) - Bright purple
    graphics.fillStyle(0x8888ff, 0.5);
    graphics.fillCircle(centerX, centerY, radius + 20);
    
    // Inner core (bright) - Light blue
    graphics.fillStyle(0xaaaaff, 0.8);
    graphics.fillCircle(centerX, centerY, radius);
    
    // Ultra-bright center - White with blue tint
    graphics.fillStyle(0xddddff, 1.0);
    graphics.fillCircle(centerX, centerY, radius * 0.6);
    
    // Add some energy rings - Purple/blue theme
    graphics.lineStyle(4, 0x6666ff, 0.8);
    graphics.strokeCircle(centerX, centerY, radius * 0.8);
    graphics.lineStyle(6, 0x8888ff, 0.6);
    graphics.strokeCircle(centerX, centerY, radius * 1.1);
  }

  private drawLaserBeam(graphics: Phaser.GameObjects.Graphics, startX: number, startY: number, endX: number, endY: number) {
    graphics.clear();
    
    // Outer glow (thick, transparent)
    graphics.lineStyle(20, 0x00ffff, 0.3);
    graphics.beginPath();
    graphics.moveTo(startX, startY);
    graphics.lineTo(endX, endY);
    graphics.strokePath();
    
    // Middle beam (medium thickness)
    graphics.lineStyle(12, 0x66ffff, 0.8);
    graphics.beginPath();
    graphics.moveTo(startX, startY);
    graphics.lineTo(endX, endY);
    graphics.strokePath();
    
    // Inner core (thin, bright)
    graphics.lineStyle(6, 0xffffff, 1.0);
    graphics.beginPath();
    graphics.moveTo(startX, startY);
    graphics.lineTo(endX, endY);
    graphics.strokePath();
    
    // Ultra-bright center line
    graphics.lineStyle(2, 0xffffff, 1.0);
    graphics.beginPath();
    graphics.moveTo(startX, startY);
    graphics.lineTo(endX, endY);
    graphics.strokePath();
  }

  private createLaserImpactEffects(startX: number, startY: number, endX: number, endY: number) {
    // Create sparks and explosions along the laser path
    const numEffects = 8;
    for (let i = 0; i <= numEffects; i++) {
      const progress = i / numEffects;
      const effectX = Phaser.Math.Linear(startX, endX, progress);
      const effectY = Phaser.Math.Linear(startY, endY, progress);
      
      this.time.delayedCall(i * 30, () => {
        // Create explosion effect at this point
        for (let j = 0; j < 8; j++) {
          const angle = (j / 8) * Math.PI * 2;
          const distance = 15 + Math.random() * 25;
          const sparkX = effectX + Math.cos(angle) * distance;
          const sparkY = effectY + Math.sin(angle) * distance;
          
          const spark = this.add.rectangle(effectX, effectY, 8, 8, 0xffffff).setDepth(25);
          
          this.tweens.add({
            targets: spark,
            x: sparkX,
            y: sparkY,
            scale: 0.1,
            alpha: 0,
            duration: 300 + Math.random() * 200,
            ease: 'Quad.easeOut',
            onComplete: () => spark.destroy()
          });
        }
      });
    }
  }

  private createAOEImpactEffects(centerX: number, centerY: number, radius: number) {
    // Create sparks and explosions in a circular pattern around the AOE
    const numRings = 4;
    const effectsPerRing = 12;
    
    for (let ring = 0; ring < numRings; ring++) {
      const ringRadius = (radius / numRings) * (ring + 1);
      
      for (let i = 0; i < effectsPerRing; i++) {
        const angle = (i / effectsPerRing) * Math.PI * 2;
        const effectX = centerX + Math.cos(angle) * ringRadius;
        const effectY = centerY + Math.sin(angle) * ringRadius;
        
        this.time.delayedCall(ring * 50 + i * 10, () => {
          // Create explosion effect at this point
          for (let j = 0; j < 6; j++) {
            const sparkAngle = (j / 6) * Math.PI * 2;
            const distance = 10 + Math.random() * 20;
            const sparkX = effectX + Math.cos(sparkAngle) * distance;
            const sparkY = effectY + Math.sin(sparkAngle) * distance;
            
            const spark = this.add.rectangle(effectX, effectY, 6, 6, 0x00ffff).setDepth(25);
            
            this.tweens.add({
              targets: spark,
              x: sparkX,
              y: sparkY,
              scale: 0.1,
              alpha: 0,
              duration: 250 + Math.random() * 150,
              ease: 'Quad.easeOut',
              onComplete: () => spark.destroy()
            });
          }
        });
      }
    }
    
    // Create expanding shockwave rings
    for (let i = 0; i < 3; i++) {
      this.time.delayedCall(i * 100, () => {
        const shockwave = this.add.graphics().setDepth(15);
        shockwave.lineStyle(8, 0x00ffff, 0.8);
        shockwave.strokeCircle(centerX, centerY, 20);
        
        this.tweens.add({
          targets: shockwave,
          scaleX: radius / 20,
          scaleY: radius / 20,
          alpha: 0,
          duration: 600,
          ease: 'Quad.easeOut',
          onComplete: () => shockwave.destroy()
        });
      });
    }
  }

  private destroyDemonsWithLaser(startX: number, startY: number, endX: number, endY: number) {
    // AOE STUN ATTACK: Find all demons within 10 unit radius of the player (converted to pixels)
    const attackRadius = 10 * 32; // 10 units * 32 pixels per unit = 320 pixel radius
    const playerX = this.player.x;
    const playerY = this.player.y;
    
    const demonsHit = this.demons.filter(demon => {
      // Only target demons that aren't already stunned
      if (demon.isStunned) return false;
      
      // Calculate distance from player to demon
      const distanceToPlayer = Phaser.Math.Distance.Between(
        playerX, playerY,
        demon.sprite.x, demon.sprite.y
      );
      
      // Check if demon is within the attack radius
      return distanceToPlayer <= attackRadius;
    });

    console.log(`⚡ AOE STUN ATTACK HITS ${demonsHit.length} DEMONS within ${attackRadius} pixel radius!`);

    // Stun each demon with spectacular effect
    demonsHit.forEach((demon, index) => {
      this.time.delayedCall(index * 50, () => {
        // Stun the demon instead of killing it
        this.stunDemon(demon);
      });
    });

    // Extra screen shake for multiple hits
    if (demonsHit.length > 0) {
      this.cameras.main.shake(200 + demonsHit.length * 100, 0.01 + demonsHit.length * 0.005);
    }
  }

  private stunDemon(demon: any) {
    console.log('💫 Demon stunned!');
    
    // Set stun properties
    demon.isStunned = true;
    demon.stunDuration = 5000; // 5 seconds of stun
    
    // Stop demon movement
    demon.body.setVelocity(0, 0);
    
    // Visual stun effect
    this.createStunEffect(demon.sprite.x, demon.sprite.y);
    
    // Change demon appearance to show stunned state
    demon.sprite.setTint(0x6666ff); // Blue tint for stunned
    
    // Add spinning animation to show stunned state
    this.tweens.add({
      targets: demon.sprite,
      angle: 360,
      duration: 1000,
      repeat: 4, // Spin 5 times during stun
      ease: 'Linear'
    });
    
    // Add floating animation
    this.tweens.add({
      targets: demon.sprite,
      y: demon.sprite.y - 10,
      duration: 500,
      yoyo: true,
      repeat: 9, // Float up and down during stun
      ease: 'Sine.easeInOut'
    });
  }

  private createStunEffect(x: number, y: number) {
    // Create stun stars effect
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const distance = 25;
      const starX = x + Math.cos(angle) * distance;
      const starY = y + Math.sin(angle) * distance;
      
      // Create star shape using graphics
      const star = this.add.graphics().setDepth(15);
      star.fillStyle(0xffff00, 1);
      
      // Draw a simple star shape manually
      star.beginPath();
      for (let j = 0; j < 5; j++) {
        const angle = (j * 144 - 90) * Math.PI / 180;
        const x = starX + Math.cos(angle) * 6;
        const y = starY + Math.sin(angle) * 6;
        if (j === 0) star.moveTo(x, y);
        else star.lineTo(x, y);
      }
      star.closePath();
      star.fillPath();
      
      // Animate stars orbiting around demon
      this.tweens.add({
        targets: star,
        angle: 360,
        duration: 2000,
        repeat: 2,
        ease: 'Linear',
        onComplete: () => star.destroy()
      });
      
      // Make stars orbit around the demon
      this.tweens.add({
        targets: star,
        x: x + Math.cos(angle + Math.PI * 2) * distance,
        y: y + Math.sin(angle + Math.PI * 2) * distance,
        duration: 2000,
        repeat: 2,
        ease: 'Linear'
      });
    }
    
    // Create "ZZZ" sleep effect
    const sleepText = this.add.text(x, y - 40, 'ZZZ', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(20);
    
    // Animate sleep text
    this.tweens.add({
      targets: sleepText,
      y: y - 60,
      alpha: 0,
      duration: 5000,
      ease: 'Sine.easeOut',
      onComplete: () => sleepText.destroy()
    });
  }

  private createLaserDemonExplosion(x: number, y: number) {
    // Create massive explosion effect for laser-killed demons
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const distance = 30 + Math.random() * 40;
      const explosionX = x + Math.cos(angle) * distance;
      const explosionY = y + Math.sin(angle) * distance;
      
      const particle = this.add.rectangle(x, y, 12, 12, 0x00ffff).setDepth(30);
      
      this.tweens.add({
        targets: particle,
        x: explosionX,
        y: explosionY,
        scale: 0.1,
        alpha: 0,
        duration: 400 + Math.random() * 300,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }
    
    // Create white flash at explosion center
    const flash = this.add.circle(x, y, 25, 0xffffff, 0.8).setDepth(35);
    this.tweens.add({
      targets: flash,
      scale: 2,
      alpha: 0,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy()
    });
  }

  private destroyDemonsInFront() {
    const playerDirection = this.player.flipX ? -1 : 1;
    const spellRange = 600; // Range of spell effect
    
    // Find demons in front of player
    const demonsInRange = this.demons.filter(demon => {
      const distanceX = demon.sprite.x - this.player.x;
      const distanceY = Math.abs(demon.sprite.y - this.player.y);
      
      // Check if demon is in front and within range
      const isInFront = playerDirection > 0 ? distanceX > 0 : distanceX < 0;
      const isInRange = Math.abs(distanceX) <= spellRange && distanceY <= 200;
      
      return isInFront && isInRange;
    });

    console.log(`💥 Spell hits ${demonsInRange.length} demons!`);

    // Destroy each demon with dramatic effect
    demonsInRange.forEach((demon, index) => {
      this.time.delayedCall(index * 100, () => {
        // Massive explosion effect for each demon
        for (let i = 0; i < 15; i++) {
          const angle = (i / 15) * Math.PI * 2;
          const dist = 40;
          const particle = this.add.rectangle(
            demon.sprite.x,
            demon.sprite.y,
            8,
            8,
            0xffd700
          ).setDepth(11);
          
          this.tweens.add({
            targets: particle,
            x: demon.sprite.x + Math.cos(angle) * dist,
            y: demon.sprite.y + Math.sin(angle) * dist,
            alpha: 0,
            scale: 0.1,
            duration: 600,
            ease: 'Quad.easeOut',
            onComplete: () => particle.destroy(),
          });
        }

        // Remove demon from game
        this.killDemon(demon);
      });
    });

    // Screen shake for powerful spell
    this.cameras.main.shake(300, 0.01);
  }

  private showSpellFailure() {
    // Track pronunciation failure
    this.pronunciationMistakes++;
    // Mark that player is attempting spells (for death tracking)
    this.diedDuringSpell = true;
    console.log(`⚠️ Pronunciation failure. Mistakes: ${this.pronunciationMistakes}`);

    const failText = this.add.text(
      this.player.x,
      this.player.y - 60,
      '❌ UNKNOWN SPELL',
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ef4444',
        stroke: '#000000',
        strokeThickness: 3,
      }
    )
    .setOrigin(0.5)
    .setDepth(100)
    .setScrollFactor(1);

    this.tweens.add({
      targets: failText,
      alpha: 0,
      duration: 1500,
      ease: 'Sine.easeOut',
      onComplete: () => failText.destroy(),
    });

    // If 2 or more pronunciation failures, show Jumuf
    if (this.pronunciationMistakes >= 2) {
      this.showJumuf();
      this.jumufGiveHint('Let\'s try that sound again.');
      this.pronunciationMistakes = 0; // Reset counter
    }
  }

  // ===========================
  // GEMINI STT PRONUNCIATION DETECTION
  // ===========================

  private async checkPronunciation(targetWord: string): Promise<boolean> {
    try {
      console.log(`🎤 Starting pronunciation check for: "${targetWord}"`);
      
      // Show recording indicator
      const recordingText = this.add.text(
        this.player.x,
        this.player.y - 80,
        '🎤 RECORDING... Say "' + targetWord.toLowerCase() + '"',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#ff6b6b',
          stroke: '#000000',
          strokeThickness: 2,
        }
      ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

      // Start audio recording
      const audioBlob = await this.recordAudio(3000); // 3 second recording
      
      recordingText.destroy();

      // Show processing indicator
      const processingText = this.add.text(
        this.player.x,
        this.player.y - 80,
        '🔄 PROCESSING...',
        {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#fbbf24',
          stroke: '#000000',
          strokeThickness: 2,
        }
      ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

      // Send to Gemini STT API
      const transcription = await this.sendToGeminiSTT(audioBlob);
      
      processingText.destroy();

      // Compare transcription with target word (case-insensitive)
      const isMatch = transcription.toLowerCase().trim() === targetWord.toLowerCase().trim();
      
      console.log(`🎤 Transcription: "${transcription}" | Target: "${targetWord}" | Match: ${isMatch}`);
      
      if (isMatch) {
        this.showPronunciationSuccess(targetWord);
        return true;
      } else {
        this.showPronunciationError(transcription, targetWord);
        return false;
      }
      
    } catch (error) {
      console.error('🎤 Pronunciation check failed:', error);
      this.showPronunciationError('Error', targetWord);
      return false;
    }
  }

  private async recordAudio(duration: number): Promise<Blob> {
    return new Promise(async (resolve, reject) => {
      try {
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        this.audioChunks = [];
        this.mediaRecorder = new MediaRecorder(stream);
        this.isRecordingPronunciation = true;

        this.mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            this.audioChunks.push(event.data);
          }
        };

        this.mediaRecorder.onstop = () => {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
          stream.getTracks().forEach(track => track.stop()); // Stop microphone
          this.isRecordingPronunciation = false;
          resolve(audioBlob);
        };

        this.mediaRecorder.onerror = (event) => {
          stream.getTracks().forEach(track => track.stop());
          this.isRecordingPronunciation = false;
          reject(event);
        };

        // Start recording
        this.mediaRecorder.start();

        // Stop recording after specified duration
        setTimeout(() => {
          if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
          }
        }, duration);

      } catch (error) {
        this.isRecordingPronunciation = false;
        reject(error);
      }
    });
  }

  private async sendToGeminiSTT(audioBlob: Blob): Promise<string> {
    try {
      // Convert audio blob to base64
      const base64Audio = await this.blobToBase64(audioBlob);
      
      // Gemini API endpoint for speech-to-text
      // TODO: Replace 'YOUR_GEMINI_API_KEY' with your actual Gemini API key
      // Get your API key from: https://makersuite.google.com/app/apikey
      const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY'; // Replace with your actual API key
      const GEMINI_STT_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;
      
      const requestBody = {
        contents: [{
          parts: [{
            text: `Please transcribe this audio to text. Only return the spoken words, nothing else.`
          }, {
            inline_data: {
              mime_type: audioBlob.type,
              data: base64Audio.split(',')[1] // Remove data:audio/wav;base64, prefix
            }
          }]
        }]
      };

      const response = await fetch(GEMINI_STT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Extract transcription from Gemini response
      const transcription = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      
      return transcription;
      
    } catch (error) {
      console.error('🎤 Gemini STT API error:', error);
      throw error;
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  private showPronunciationSuccess(word: string) {
    // Track successful pronunciation in analytics
    trackPronunciationAttempt(true);
    trackPronunciationWordResult(word, true);
    const successText = this.add.text(
      this.player.x,
      this.player.y - 80,
      `✅ PERFECT! "${word.toUpperCase()}" UNLOCKED!`,
      {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#22c55e',
        stroke: '#000000',
        strokeThickness: 3,
      }
    ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

    this.tweens.add({
      targets: successText,
      alpha: 0,
      y: successText.y - 40,
      duration: 2000,
      ease: 'Sine.easeOut',
      onComplete: () => successText.destroy(),
    });
  }

  private showPronunciationError(heard: string, target: string) {
    // Track failed pronunciation in analytics
    trackPronunciationAttempt(false);
    trackPronunciationWordResult(target, false);
    // Track pronunciation failure
    this.pronunciationMistakes++;
    this.lastFailedSpell = target;
    // Mark that player is attempting spells (for death tracking)
    this.diedDuringSpell = true;
    console.log(`⚠️ Pronunciation failure. Mistakes: ${this.pronunciationMistakes}`);

    const errorText = this.add.text(
      this.player.x,
      this.player.y - 80,
      `❌ Heard: "${heard}" | Try: "${target.toLowerCase()}"`,
      {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ef4444',
        stroke: '#000000',
        strokeThickness: 2,
      }
    ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

    this.tweens.add({
      targets: errorText,
      alpha: 0,
      duration: 3000,
      ease: 'Sine.easeOut',
      onComplete: () => errorText.destroy(),
    });

    // If 2 or more pronunciation failures, show Jumuf
    if (this.pronunciationMistakes >= 2) {
      this.showJumuf();
      this.jumufGiveHint('Let\'s try that sound again.');
      this.pronunciationMistakes = 0; // Reset counter
    }
  }

  private createCaveEnvironment() {
    const worldWidth = this.map.widthInPixels + 8000;
    const worldHeight = this.map.heightInPixels;

    // Create cave tunnel background
    this.createCaveTunnelBackground(worldWidth, worldHeight);
    
    // Create tunnel walls and ceiling
    this.createTunnelWalls(worldWidth, worldHeight);
    
    // Add stalactites and stalagmites for tunnel atmosphere
    this.createTunnelFormations(worldWidth);

    // Add cave crystals for ambient lighting
    this.createCaveCrystals();
    
    // Add tunnel depth layers for 3D effect
    this.createTunnelDepthLayers(worldWidth, worldHeight);
  }

  private createCaveTunnelBackground(worldWidth: number, worldHeight: number) {
    // Create deeper cave tunnel background
    if (!this.textures.exists('tunnel_back')) {
      const g = this.add.graphics();
      
      // Deep tunnel background (very dark)
      g.fillStyle(0x0a0a0a, 1);
      g.fillRect(0, 0, 128, 128);
      
      // Add some subtle rock texture
      g.fillStyle(0x1a1a1a, 1);
      g.fillRect(10, 20, 30, 15);
      g.fillRect(60, 40, 25, 20);
      g.fillRect(20, 80, 40, 25);
      g.fillRect(80, 10, 20, 30);
      
      // Very subtle highlights
      g.fillStyle(0x2a2a2a, 1);
      g.fillRect(12, 22, 15, 8);
      g.fillRect(62, 42, 12, 10);
      g.fillRect(22, 82, 20, 12);
      
      g.generateTexture('tunnel_back', 128, 128);
      g.destroy();
    }

    // Create tiled tunnel background
    const tilesX = Math.ceil(worldWidth / 128);
    const tilesY = Math.ceil(worldHeight / 128);
    
    for (let x = 0; x < tilesX; x++) {
      for (let y = 0; y < tilesY; y++) {
        const tileX = -200 + x * 128;
        const tileY = y * 128;
        this.add.image(tileX, tileY, 'tunnel_back')
          .setOrigin(0, 0)
          .setDepth(-15)
          .setScrollFactor(0.1); // Deep parallax for tunnel depth
      }
    }
  }

  private createTunnelWalls(worldWidth: number, worldHeight: number) {
    // Create tunnel wall texture
    if (!this.textures.exists('tunnel_wall')) {
      const g = this.add.graphics();
      
      // Tunnel wall base (dark brown/gray)
      g.fillStyle(0x3a3a3a, 1);
      g.fillRect(0, 0, 64, 64);
      
      // Rock formations and cracks
      g.fillStyle(0x4a4a4a, 1);
      g.fillRect(5, 10, 20, 12);
      g.fillRect(30, 25, 15, 18);
      g.fillRect(10, 45, 25, 10);
      
      // Highlights on rock formations
      g.fillStyle(0x5a5a5a, 1);
      g.fillRect(5, 10, 10, 6);
      g.fillRect(30, 25, 8, 9);
      g.fillRect(10, 45, 12, 5);
      
      // Dark cracks and crevices
      g.fillStyle(0x1a1a1a, 1);
      g.fillRect(15, 5, 2, 25);
      g.fillRect(40, 15, 3, 20);
      g.fillRect(25, 35, 2, 15);
      
      // Cave moisture (darker spots)
      g.fillStyle(0x2a2a2a, 1);
      g.fillRect(20, 8, 8, 4);
      g.fillRect(45, 30, 6, 8);
      g.fillRect(8, 50, 10, 6);
      
      g.generateTexture('tunnel_wall', 64, 64);
      g.destroy();
    }

    // Create tunnel ceiling
    const ceilingHeight = 100;
    const tunnelTop = 50;
    
    // Top tunnel wall
    for (let x = -200; x < worldWidth; x += 64) {
      for (let y = 0; y < ceilingHeight; y += 64) {
        this.add.image(x, y, 'tunnel_wall')
          .setOrigin(0, 0)
          .setDepth(-8)
          .setScrollFactor(0.6);
      }
    }

    // Bottom tunnel wall (below the playable area)
    const floorStart = worldHeight - 50;
    for (let x = -200; x < worldWidth; x += 64) {
      for (let y = floorStart; y < worldHeight + 100; y += 64) {
        this.add.image(x, y, 'tunnel_wall')
          .setOrigin(0, 0)
          .setDepth(-8)
          .setScrollFactor(0.6);
      }
    }

    // Create tunnel entrance and exit
    this.createTunnelEntranceExit(worldWidth, worldHeight);
  }

  private createTunnelEntranceExit(worldWidth: number, worldHeight: number) {
    // Tunnel entrance (left side)
    const entranceGradient = this.add.graphics().setDepth(-7);
    entranceGradient.fillGradientStyle(0x000000, 0x000000, 0x3a3a3a, 0x3a3a3a, 0.8, 0.8, 0.2, 0.2);
    entranceGradient.fillRect(-200, 100, 300, worldHeight - 200);

    // Tunnel exit (right side) 
    const exitGradient = this.add.graphics().setDepth(-7);
    exitGradient.fillGradientStyle(0x3a3a3a, 0x3a3a3a, 0x000000, 0x000000, 0.2, 0.2, 0.8, 0.8);
    exitGradient.fillRect(worldWidth - 300, 100, 300, worldHeight - 200);
  }

  private createTunnelFormations(worldWidth: number) {
    // Enhanced stalactites for tunnel ceiling
    const stalactitePositions = [];
    for (let x = 0; x < worldWidth; x += 80 + Math.random() * 120) {
      stalactitePositions.push(x);
    }

    stalactitePositions.forEach(x => {
      // Vary stalactite sizes and positions
      const offsetY = Math.random() * 30;
      const offsetX = (Math.random() - 0.5) * 50;
      const scale = 0.8 + Math.random() * 0.6;
      
      const stalactite = this.add.image(x + offsetX, 100 + offsetY, 'stalactite')
        .setOrigin(0.5, 0)
        .setDepth(-6)
        .setScale(scale)
        .setScrollFactor(0.7);
      
      // Add slight tint variation
      if (Math.random() > 0.7) {
        stalactite.setTint(0x8a8a8a);
      }
    });

    // Add stalagmites from tunnel floor
    this.createStalagmites(worldWidth);
    
    // Add tunnel rock formations
    this.createTunnelRockFormations(worldWidth);
  }

  private createStalagmites(worldWidth: number) {
    // Create stalagmite texture
    if (!this.textures.exists('stalagmite')) {
      const g = this.add.graphics();
      
      // Stalagmite shape (pointing up)
      g.fillStyle(0x4a4a4a, 1);
      g.fillRect(4, 8, 8, 16);
      g.fillRect(3, 12, 10, 8);
      g.fillRect(2, 16, 12, 4);
      
      // Highlights
      g.fillStyle(0x5a5a5a, 1);
      g.fillRect(4, 8, 4, 16);
      g.fillRect(3, 12, 5, 8);
      
      // Shadows
      g.fillStyle(0x2a2a2a, 1);
      g.fillRect(10, 10, 2, 14);
      g.fillRect(11, 14, 3, 6);
      
      g.generateTexture('stalagmite', 16, 24);
      g.destroy();
    }

    // Place stalagmites along tunnel floor
    for (let x = 200; x < worldWidth - 200; x += 150 + Math.random() * 200) {
      const offsetX = (Math.random() - 0.5) * 60;
      const scale = 0.6 + Math.random() * 0.8;
      
      this.add.image(x + offsetX, this.map.heightInPixels - 20, 'stalagmite')
        .setOrigin(0.5, 1)
        .setDepth(-6)
        .setScale(scale)
        .setScrollFactor(0.8);
    }
  }

  private createTunnelRockFormations(worldWidth: number) {
    // Create rock formation texture
    if (!this.textures.exists('rock_formation')) {
      const g = this.add.graphics();
      
      // Large rock formation
      g.fillStyle(0x3a3a3a, 1);
      g.fillRect(0, 10, 40, 30);
      g.fillRect(5, 5, 30, 20);
      g.fillRect(10, 0, 20, 15);
      
      // Rock highlights
      g.fillStyle(0x4a4a4a, 1);
      g.fillRect(0, 10, 20, 15);
      g.fillRect(5, 5, 15, 10);
      g.fillRect(10, 0, 10, 8);
      
      // Dark crevices
      g.fillStyle(0x1a1a1a, 1);
      g.fillRect(18, 8, 3, 25);
      g.fillRect(25, 12, 2, 20);
      
      g.generateTexture('rock_formation', 40, 40);
      g.destroy();
    }

    // Place rock formations along tunnel walls
    for (let x = 300; x < worldWidth - 300; x += 400 + Math.random() * 300) {
      // Floor formations
      this.add.image(x, this.map.heightInPixels - 40, 'rock_formation')
        .setOrigin(0.5, 1)
        .setDepth(-5)
        .setScrollFactor(0.9);
      
      // Ceiling formations (occasionally)
      if (Math.random() > 0.6) {
        this.add.image(x + 100, 140, 'rock_formation')
          .setOrigin(0.5, 0)
          .setDepth(-5)
          .setScale(0.8)
          .setFlipY(true)
          .setScrollFactor(0.9);
      }
    }
  }

  private createTunnelDepthLayers(worldWidth: number, worldHeight: number) {
    // Add atmospheric depth with gradient overlays
    const atmosphereOverlay = this.add.graphics().setDepth(-12);
    
    // Create subtle gradient from top to bottom for tunnel atmosphere
    atmosphereOverlay.fillGradientStyle(
      0x1a1a2e, 0x1a1a2e, 0x0f0f23, 0x0f0f23,
      0.3, 0.3, 0.1, 0.1
    );
    atmosphereOverlay.fillRect(-200, 0, worldWidth + 400, worldHeight);
    
    // Add tunnel fog/mist effect
    for (let i = 0; i < 8; i++) {
      const mistX = (worldWidth / 8) * i;
      const mistY = 200 + Math.random() * 200;
      const mistWidth = 300 + Math.random() * 200;
      const mistHeight = 100 + Math.random() * 100;
      
      const mist = this.add.graphics().setDepth(-11);
      mist.fillStyle(0x4a4a6a, 0.1);
      mist.fillEllipse(mistX, mistY, mistWidth, mistHeight);
      mist.setScrollFactor(0.4);
    }
  }

  private createCaveCrystals() {
    // Create enhanced glowing crystal texture for tunnel
    if (!this.textures.exists('cave_crystal')) {
      const g = this.add.graphics();
      
      // Crystal base (blue with more variety)
      g.fillStyle(0x3b82f6, 1);
      g.fillRect(2, 4, 4, 8);
      g.fillRect(1, 6, 6, 4);
      
      // Crystal highlights (light blue)
      g.fillStyle(0x60a5fa, 1);
      g.fillRect(2, 4, 2, 8);
      g.fillRect(1, 6, 3, 4);
      
      // Crystal core (white)
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 7, 1, 2);
      
      g.generateTexture('cave_crystal', 8, 12);
      g.destroy();
    }

    // Create purple crystal variant for variety
    if (!this.textures.exists('cave_crystal_purple')) {
      const g = this.add.graphics();
      
      g.fillStyle(0x8b5cf6, 1);
      g.fillRect(2, 4, 4, 8);
      g.fillRect(1, 6, 6, 4);
      
      g.fillStyle(0xa78bfa, 1);
      g.fillRect(2, 4, 2, 8);
      g.fillRect(1, 6, 3, 4);
      
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 7, 1, 2);
      
      g.generateTexture('cave_crystal_purple', 8, 12);
      g.destroy();
    }

    // Place crystals throughout the tunnel for atmospheric lighting
    const worldWidth = this.map.widthInPixels + 8000;
    
    // Ceiling crystals
    for (let x = 200; x < worldWidth - 200; x += 180 + Math.random() * 120) {
      const offsetX = (Math.random() - 0.5) * 80;
      const offsetY = Math.random() * 40;
      const crystalType = Math.random() > 0.7 ? 'cave_crystal_purple' : 'cave_crystal';
      const scale = 0.8 + Math.random() * 0.6;
      
      const crystal = this.add.image(x + offsetX, 140 + offsetY, crystalType)
        .setOrigin(0.5, 0)
        .setDepth(-3)
        .setScale(scale)
        .setFlipY(true); // Hanging from ceiling

      // Enhanced glow effect for tunnel atmosphere
      const glowColor = crystalType === 'cave_crystal_purple' ? 0x8b5cf6 : 0x3b82f6;
      const glow = this.add.circle(x + offsetX, 140 + offsetY + 6, 20 * scale, glowColor, 0.15)
        .setDepth(-4);

      // Animate crystal glow with variation
      this.tweens.add({
        targets: [crystal, glow],
        alpha: 0.4 + Math.random() * 0.4,
        duration: 1500 + Math.random() * 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Wall crystals (embedded in tunnel walls)
    for (let x = 400; x < worldWidth - 400; x += 300 + Math.random() * 200) {
      const isLeftWall = Math.random() > 0.5;
      const wallY = 200 + Math.random() * 200;
      const crystalType = Math.random() > 0.6 ? 'cave_crystal_purple' : 'cave_crystal';
      const scale = 0.6 + Math.random() * 0.4;
      
      const crystal = this.add.image(x, wallY, crystalType)
        .setOrigin(0.5, 0.5)
        .setDepth(-2)
        .setScale(scale);

      // Wall crystal glow
      const glowColor = crystalType === 'cave_crystal_purple' ? 0x8b5cf6 : 0x3b82f6;
      const glow = this.add.circle(x, wallY, 25 * scale, glowColor, 0.1)
        .setDepth(-3);

      // Subtle pulsing animation
      this.tweens.add({
        targets: [crystal, glow],
        alpha: 0.3 + Math.random() * 0.5,
        scale: scale * (0.9 + Math.random() * 0.2),
        duration: 2000 + Math.random() * 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    // Floor crystal clusters for ambient lighting
    for (let x = 600; x < worldWidth - 600; x += 500 + Math.random() * 300) {
      this.createCrystalCluster(x, this.spawnPoint.y + 20);
    }
  }

  private createCrystalCluster(centerX: number, centerY: number) {
    // Create a small cluster of crystals for more natural lighting
    const clusterSize = 3 + Math.floor(Math.random() * 4);
    
    for (let i = 0; i < clusterSize; i++) {
      const angle = (i / clusterSize) * Math.PI * 2;
      const distance = 15 + Math.random() * 25;
      const crystalX = centerX + Math.cos(angle) * distance;
      const crystalY = centerY + Math.sin(angle) * distance;
      const crystalType = Math.random() > 0.5 ? 'cave_crystal_purple' : 'cave_crystal';
      const scale = 0.4 + Math.random() * 0.4;
      
      const crystal = this.add.image(crystalX, crystalY, crystalType)
        .setOrigin(0.5, 1)
        .setDepth(-2)
        .setScale(scale);

      // Cluster glow effect
      const glowColor = crystalType === 'cave_crystal_purple' ? 0x8b5cf6 : 0x3b82f6;
      const glow = this.add.circle(crystalX, crystalY - 6, 15 * scale, glowColor, 0.12)
        .setDepth(-3);

      // Synchronized cluster animation
      this.tweens.add({
        targets: [crystal, glow],
        alpha: 0.5 + Math.random() * 0.3,
        duration: 1800 + i * 200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }


  update(_: number, delta: number) {
    // Pause guard for end-of-level overlay
    if ((window as any).__GAME_PAUSED__) return;

    this.updateMovingHazards(delta);
    this.updateEnemies();
    this.updateDemons();

    // Update Jumuf following
    this.updateJumufFollow();

    // Check if player is in a hook zone and update UI accordingly
    this.checkHookZoneStatus();

    // Check for P key to release hook and drop from suspension
    if (this.isSuspended && this.releaseHookKey && Phaser.Input.Keyboard.JustDown(this.releaseHookKey)) {
      console.log('🔓 P key pressed - releasing hook and dropping player');
      this.endAirSuspension();
    }

    // Update hint bubble position if active
    if (this.jumufHintBubble && this.jumuf) {
      this.jumufHintBubble.setPosition(this.jumuf.x, this.jumuf.y - 60);
    }

    // Check if Djinn should give hook guidance
    this.checkForHookGuidanceNeeded();

    // Update PronunciationDoor
    if (this.pronunciationDoor) {
      this.pronunciationDoor.update();
    }

    // Handle game over review Enter key
    if (this.gameOverReviewActive && this.gameOverReviewEnterKey) {
      if (Phaser.Input.Keyboard.JustDown(this.gameOverReviewEnterKey)) {
        // Clean up review panel
        if (this.gameOverReviewPanel) {
          this.gameOverReviewPanel.panelBg.destroy();
          this.gameOverReviewPanel.panelBorder.destroy();
          this.gameOverReviewPanel.titleText.destroy();
          this.gameOverReviewPanel.contentText.destroy();
          this.gameOverReviewPanel.enterText.destroy();
          this.gameOverReviewPanel = undefined;
        }
        
        this.hideJumuf();
        
        // Reset death count
        this.deaths = 0;
        this.diedDuringSpell = false;
        this.lastFailedSpell = undefined;
        
        // Respawn player
        this.handleHazardHit();
        
        this.gameOverReviewActive = false;
      }
    }

    // Update attack cooldown
    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta;
    }

    if (!this.manualControlEnabled || this.isTraversing) {
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const left = (this.cursors.left?.isDown ?? false) || (this.wasdKeys?.left.isDown ?? false);
    const right = (this.cursors.right?.isDown ?? false) || (this.wasdKeys?.right.isDown ?? false);
    const jumpJustPressed =
      Phaser.Input.Keyboard.JustDown(this.jumpKey!) ||
      (this.cursors.up ? Phaser.Input.Keyboard.JustDown(this.cursors.up) : false) ||
      (this.wasdKeys?.up ? Phaser.Input.Keyboard.JustDown(this.wasdKeys.up) : false);
    const jumpHeld =
      (this.jumpKey?.isDown ?? false) ||
      (this.cursors.up?.isDown ?? false) ||
      (this.wasdKeys?.up.isDown ?? false);
    const attackPressed = Phaser.Input.Keyboard.JustDown(this.attackKey!);
    const voicePressed = Phaser.Input.Keyboard.JustDown(this.voiceKey!);
    const doorPressed = Phaser.Input.Keyboard.JustDown(this.doorKey!);
    const onGround = body.blocked.down;
    const movementMultiplier = this.playerSlowMovementMultiplier;

    // Handle attack input
    if (attackPressed) {
      this.handleAttack();
    }

    // Handle door activation (G key)
    if (doorPressed) {
      // Check if player is near PronunciationDoor
      if (this.pronunciationDoor) {
        const distanceToDoor = Phaser.Math.Distance.Between(
          this.player.x,
          this.player.y,
          this.pronunciationDoor.x,
          this.pronunciationDoor.y
        );

        // If within 300 pixels of door, start door listening
        if (distanceToDoor < 300) {
          this.pronunciationDoor.startListening();
          return;
        }
      }
    }

    // Handle voice input
    if (voicePressed) {
      if (this.pronunciationDoor?.isChallengeRunning()) {
        this.startListening();
        return;
      }

      // Check if HUNGRY traversal is complete but not yet unlocked
      if (this.completedWords.includes('HUNGRY') && !this.hungryUnlocked && !this.completedSpellWords.includes('HUNGRY')) {
        this.handleHungryPronunciationCheck();
      } else {
        this.startListening();
      }
    }

    if (left) {
      body.setAccelerationX(-PLAYER_ACCELERATION * movementMultiplier);
      body.setDragX(0);
      this.player.setFlipX(true); // Face left
    } else if (right) {
      body.setAccelerationX(PLAYER_ACCELERATION * movementMultiplier);
      body.setDragX(0);
      this.player.setFlipX(false); // Face right
    } else {
      body.setAccelerationX(0);
      body.setDragX(PLAYER_DRAG);
    }

    body.setMaxVelocity(PLAYER_MAX_VELOCITY_X * movementMultiplier, 800);

    if (onGround) {
      this.coyoteTimer = COYOTE_TIME;
      this.hasJumped = false;
      this.jumpSustain = false;
    } else {
      this.coyoteTimer -= 16;
    }

    if ((jumpJustPressed && (onGround || this.coyoteTimer > 0)) && !this.hasJumped) {
      body.setVelocityY(PLAYER_JUMP_VELOCITY);
      this.hasJumped = true;
      this.jumpSustain = true;
      this.jumpTime = 0;
    }

    if (jumpHeld && this.jumpSustain && this.jumpTime < 120) {
      body.setVelocityY(PLAYER_JUMP_SUSTAIN);
      this.jumpTime += 16;
    } else {
      this.jumpSustain = false;
    }

    if (!left && !right && Math.abs(body.velocity.x) < 6) {
      body.setVelocityX(0);
    }

    // Update combat system
    this.updateCombat(delta);
  }

  // ===========================
  // COMBAT SYSTEM
  // ===========================

  private addCombatInputs() {
    this.combatKeys = {
      melee: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      dash: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      projectile: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.L),
      flare: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      frost: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      storm: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      blind: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      hungry: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
      fastTraversal: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.K),
    };
  }

  // ========== HOOK ZONE UI SYSTEM ==========
  // Checks if player is in a hook zone and manages the zone-specific UI

  private checkHookZoneStatus() {
    const playerX = this.player.x;
    let inZone = false;
    let zoneIndex = -1;

    // Check if player is in any hook zone
    for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
      const zone = this.hookZoneDefinitions[i];
      if (playerX >= zone.start && playerX <= zone.end) {
        inZone = true;
        zoneIndex = i;
        break;
      }
    }

    // Player entered a hook zone
    if (inZone && !this.isInHookZone) {
      this.enterHookZone(zoneIndex);
    }
    // Player trying to exit a hook zone
    else if (!inZone && this.isInHookZone) {
      // ========== ZONE EXIT BLOCKING ==========
      // Player cannot exit until word is complete
      if (this.currentHookZoneIndex >= 0 && !this.hookZoneSolved[this.currentHookZoneIndex]) {
        // Block exit - push player back into zone
        this.blockZoneExit();
      } else {
        // Zone complete or already solved - allow exit
        this.exitHookZone();
      }
    }
  }

  /**
   * Block player from exiting an incomplete hook zone
   * Pushes player back to zone boundary
   */
  private blockZoneExit() {
    if (this.currentHookZoneIndex < 0) return;
    if (!this.hookZoneDefinitions[this.currentHookZoneIndex]) return;

    const zone = this.hookZoneDefinitions[this.currentHookZoneIndex];
    const playerX = this.player.x;
    const body = this.player.body as Phaser.Physics.Arcade.Body;

    if (!body) return; // Safety check

    // Determine which boundary the player tried to cross
    if (playerX < zone.start) {
      // Tried to exit left - push back to left boundary
      this.player.x = zone.start + 20;
      body.setVelocityX(50); // Small push inward
    } else if (playerX > zone.end) {
      // Tried to exit right - push back to right boundary
      this.player.x = zone.end - 20;
      body.setVelocityX(-50); // Small push inward
    }

    // Show warning feedback (only once per attempt)
    if (!this.hookZoneExitBlocked) {
      this.hookZoneExitBlocked = true;
      this.showZoneExitBlockedFeedback();

      // Reset flag after delay
      this.time.delayedCall(1000, () => {
        this.hookZoneExitBlocked = false;
      });
    }
  }

  /**
   * Show feedback when player tries to exit incomplete zone
   */
  private showZoneExitBlockedFeedback() {
    const word = this.hookZoneTargetWord || '';
    const slotState = this.hookZoneSlotState || [];
    const filled = slotState.filter(s => s).length;
    const total = word.length || 0;

    // Safety check - don't show feedback if no word data
    if (total === 0) {
      console.warn('showZoneExitBlockedFeedback called with no target word');
      return;
    }

    // Create warning text
    const warningText = this.add.text(
      this.player.x,
      this.player.y - 70,
      `🚫 Complete the spell first!\n${filled}/${total} letters`,
      {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#ff6666',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center',
      }
    );
    warningText.setOrigin(0.5);
    warningText.setDepth(2000);

    // Fade out and destroy
    this.tweens.add({
      targets: warningText,
      alpha: 0,
      y: warningText.y - 30,
      duration: 1500,
      onComplete: () => warningText.destroy(),
    });

    // Flash the zone boundary
    this.flashZoneBoundary();
  }

  /**
   * Flash the zone boundary to indicate blocked exit
   */
  private flashZoneBoundary() {
    if (this.currentHookZoneIndex < 0) return;
    if (!this.hookZoneDefinitions[this.currentHookZoneIndex]) return;
    if (!this.map) return; // Safety check

    const zone = this.hookZoneDefinitions[this.currentHookZoneIndex];
    const groundY = this.map.heightInPixels - 16;

    // Create flash rectangles at boundaries
    const flashLeft = this.add.rectangle(zone.start, groundY - 200, 10, 400, 0xff0000, 0.8);
    const flashRight = this.add.rectangle(zone.end, groundY - 200, 10, 400, 0xff0000, 0.8);
    flashLeft.setDepth(1999);
    flashRight.setDepth(1999);

    // Flash animation
    this.tweens.add({
      targets: [flashLeft, flashRight],
      alpha: 0,
      duration: 500,
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        flashLeft.destroy();
        flashRight.destroy();
      },
    });
  }

  private enterHookZone(zoneIndex: number) {
    this.isInHookZone = true;
    this.currentHookZoneIndex = zoneIndex;
    const zone = this.hookZoneDefinitions[zoneIndex];
    this.hookZoneTargetWord = zone.word;
    const zoneRespawn = this.getHookZoneRespawnPoint(zoneIndex);
    if (zoneRespawn) {
      this.hookZoneEntryRespawnPoint = { zoneIndex, x: zoneRespawn.x, y: zoneRespawn.y };
    }

    // Check if this zone was already solved
    const alreadySolved = this.hookZoneSolved[zoneIndex];

    if (alreadySolved) {
      // Zone already completed - show minimal UI, allow free passage
      // Set slots as all filled
      this.hookZoneCollectedLetters = zone.word.split('');
      this.hookZoneSlotState = new Array(zone.word.length).fill(true);
      this.hookZoneFilledLetters = zone.word.split('');
      this.hookZoneExitBlocked = false;

      // Create UI showing completed word
      this.createHookZoneUI();
      return;
    }

    // Initialize slot-based state (UNIVERSAL - works for any word length)
    this.hookZoneCollectedLetters = [];
    this.hookZoneSlotState = new Array(zone.word.length).fill(false);
    this.hookZoneFilledLetters = new Array(zone.word.length).fill('');
    this.hookZoneExitBlocked = false;

    // Check if first letter was pre-collected from outside the zone
    if (this.hookZoneFirstLetterPreCollected[zoneIndex]) {
      this.hookZoneSlotState[0] = true;
      this.hookZoneFilledLetters[0] = zone.word[0];
      this.hookZoneCollectedLetters.push(zone.word[0]);
      this.hookZoneFirstLetterPreCollected[zoneIndex] = false;
    }

    // Hide the global SPELLS UI
    if (this.wordUIContainer) {
      this.wordUIContainer.setVisible(false);
    }

    // Create the hangman-style UI for this zone
    this.createHookZoneUI();

    // Give Djinn hint if not already given for this zone
    if (!this.hookZoneHintGiven[zoneIndex]) {
      this.hookZoneHintGiven[zoneIndex] = true;
      // Delay hint slightly so player sees the zone first
      this.time.delayedCall(500, () => {
        this.jumufGiveHint(zone.hint);
      });
    }

    // Start 15-second timer - if word isn't solved, flash nodes purple and track failure
    if (this.hookZoneWordTimer) {
      this.hookZoneWordTimer.remove();
    }
    this.hookZoneWordTimer = this.time.delayedCall(15000, () => {
      // Only fire if still in this zone and it's not solved
      if (this.isInHookZone && this.currentHookZoneIndex === zoneIndex && !this.hookZoneSolved[zoneIndex]) {
        trackWordFailure(zone.word);
        trackWordTimeout(zone.word);

        // Flash all letter nodes in this zone purple
        this.letters.forEach((letterText) => {
          const nodeIndex = letterText.getData('index') as number;
          if (nodeIndex !== undefined && Math.floor(nodeIndex / 10) === zoneIndex) {
            const nodeCircle = letterText.getData('nodeCircle') as Phaser.GameObjects.Arc | undefined;
            if (nodeCircle && letterText.active) {
              // Flash purple
              this.tweens.add({
                targets: nodeCircle,
                fillColor: { from: 0x9333ea, to: nodeCircle.fillColor },
                duration: 400,
                yoyo: true,
                repeat: 3,
                ease: 'Sine.easeInOut',
              });
              this.tweens.add({
                targets: letterText,
                alpha: 0.5,
                duration: 400,
                yoyo: true,
                repeat: 3,
                ease: 'Sine.easeInOut',
              });
            }
          }
        });
      }
    });
  }

  private exitHookZone() {
    this.isInHookZone = false;
    this.currentHookZoneIndex = -1;
    this.hookZoneTargetWord = '';
    this.hookZoneEntryRespawnPoint = undefined;

    // Cancel 15s word timer
    if (this.hookZoneWordTimer) {
      this.hookZoneWordTimer.remove();
      this.hookZoneWordTimer = undefined;
    }

    // Reset slot-based state for this zone only
    this.hookZoneCollectedLetters = [];
    this.hookZoneSlotState = [];
    this.hookZoneFilledLetters = [];
    this.hookZoneExitBlocked = false;

    // Destroy the hook zone UI
    if (this.hookZoneUI) {
      this.hookZoneUI.destroy();
      this.hookZoneUI = undefined;
    }

    // NOTE: Global SPELLS UI stays hidden - it's permanently disabled
    // No word UI outside of hook zones per design requirements

  }

  private createHookZoneUI() {
    // Destroy existing UI if any
    if (this.hookZoneUI) {
      this.hookZoneUI.destroy();
    }

    // Create container for hook zone UI (fixed to camera)
    this.hookZoneUI = this.add.container(0, 0).setDepth(2000).setScrollFactor(0);

    // Background panel - centered at top
    const panelWidth = 200;
    const panelHeight = 60;
    const panel = this.add.rectangle(400, 40, panelWidth, panelHeight, 0x2d1b4e, 0.9)
      .setStrokeStyle(2, 0xff6666);
    this.hookZoneUI.add(panel);

    // "SPELL:" label
    const label = this.add.text(400, 20, 'SPELL:', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#ff6666',
    }).setOrigin(0.5);
    this.hookZoneUI.add(label);

    // Update the hangman display
    this.updateHookZoneUI();
  }

  private updateHookZoneUI() {
    if (!this.hookZoneUI || !this.hookZoneTargetWord) return;

    // Remove old hangman text if exists (index 2+)
    const children = this.hookZoneUI.list.slice();
    children.forEach((child, index) => {
      if (index >= 2) {
        this.hookZoneUI!.remove(child);
        child.destroy();
      }
    });

    const targetWord = this.hookZoneTargetWord;
    const zoneIndex = this.currentHookZoneIndex;

    // Ensure slot state is properly sized
    if (this.hookZoneSlotState.length !== targetWord.length) {
      this.hookZoneSlotState = new Array(targetWord.length).fill(false);
    }

    // Check if all slots are filled AND all letters are correct
    const allSlotsFilled = this.hookZoneSlotState.length === targetWord.length &&
                           this.hookZoneSlotState.every(filled => filled);
    const allLettersCorrect = allSlotsFilled &&
                              this.hookZoneFilledLetters.every((letter, i) => letter === targetWord[i]);
    const isComplete = allLettersCorrect || (zoneIndex >= 0 && this.hookZoneSolved[zoneIndex]);
    const hasWrongLetter = allSlotsFilled && !allLettersCorrect && !(zoneIndex >= 0 && this.hookZoneSolved[zoneIndex]);

    // Create hangman-style display showing actual filled letters (including wrong ones)
    let displayText = '';
    for (let i = 0; i < targetWord.length; i++) {
      if (this.hookZoneSlotState[i]) {
        displayText += this.hookZoneFilledLetters[i] + ' ';  // Show actual letter placed
      } else {
        displayText += '_ ';  // Slot empty - show blank
      }
    }

    const hangmanText = this.add.text(400, 48, displayText.trim(), {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: isComplete ? '#22c55e' : hasWrongLetter ? '#ef4444' : '#ffffff',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5);
    this.hookZoneUI.add(hangmanText);

    // Show progress indicator
    const filledCount = this.hookZoneSlotState.filter(s => s).length;
    let progressLabel = `${filledCount}/${targetWord.length}`;
    let progressColor = '#aaaaaa';
    if (isComplete) {
      progressLabel = '✓ COMPLETE - EXIT UNLOCKED';
      progressColor = '#22c55e';
    } else if (hasWrongLetter) {
      progressLabel = '✗ WRONG LETTERS - STUCK!';
      progressColor = '#ef4444';
    }
    const progressText = this.add.text(400, 68, progressLabel, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color: progressColor,
    }).setOrigin(0.5);
    this.hookZoneUI.add(progressText);
  }

  // Called when a letter is collected in a hook zone (legacy - kept for compatibility)
  public onHookZoneLetterCollected(letter: string) {
    // Now handled by collectHookZoneLetter - this is kept for any external calls
    if (!this.isInHookZone) return;
    // Delegate to the new universal method
    this.collectHookZoneLetter(letter);
  }

  /**
   * UNIVERSAL Hook Zone Letter Collection
   * Word-agnostic: works for ANY word (BLAZE, FROST, STORM, etc.)
   * Slot-based: tracks which positions are filled, handles any click order
   */
  private collectHookZoneLetter(letter: string) {
    if (!this.isInHookZone || this.currentHookZoneIndex < 0) return;
    if (!this.hookZoneTargetWord) return;

    const targetWord = this.hookZoneTargetWord;
    // Initialize slot state if needed
    if (this.hookZoneSlotState.length !== targetWord.length) {
      this.hookZoneSlotState = new Array(targetWord.length).fill(false);
      this.hookZoneFilledLetters = new Array(targetWord.length).fill('');
    }

    // Find the FIRST position where this letter appears in the target word (left-to-right)
    // (handles duplicate letters like "FREEZE" with two E's)
    let letterUsed = false;
    let slotFilled = -1;
    for (let i = 0; i < targetWord.length; i++) {
      if (targetWord[i] === letter && !this.hookZoneSlotState[i]) {
        // Fill this slot
        this.hookZoneSlotState[i] = true;
        this.hookZoneFilledLetters[i] = letter;
        letterUsed = true;
        slotFilled = i;
        break; // Only fill one slot per click (for duplicate letters)
      }
    }

    // If letter didn't match any slot (fake/distraction letter), fill the next empty slot with the wrong letter
    if (!letterUsed) {
      for (let i = 0; i < targetWord.length; i++) {
        if (!this.hookZoneSlotState[i]) {
          this.hookZoneSlotState[i] = true;
          this.hookZoneFilledLetters[i] = letter; // Wrong letter in slot
          letterUsed = true;
          slotFilled = i;
          break;
        }
      }
    }

    // Track collected letter (for tracking which letters have been used)
    if (letterUsed) {
      this.hookZoneCollectedLetters.push(letter);
    }

    // Update the hangman UI
    this.updateHookZoneUI();

    // Check for word completion
    this.checkHookZoneCompletion();
  }

  /**
   * Check if the current hook zone word is complete
   * Triggers completion effects and marks zone as solved
   */
  private checkHookZoneCompletion() {
    if (!this.isInHookZone || this.currentHookZoneIndex < 0) return;
    if (this.hookZoneSolved[this.currentHookZoneIndex]) return; // Already solved

    const targetWord = this.hookZoneTargetWord;

    // Safety check - need a valid word to check completion
    if (!targetWord || targetWord.length === 0) return;

    // Check if all slots are filled
    const allSlotsFilled = this.hookZoneSlotState.length === targetWord.length &&
                           this.hookZoneSlotState.every(filled => filled);

    if (!allSlotsFilled) return;

    // Verify all filled letters match the target word (catches fake/wrong letters)
    const allLettersCorrect = this.hookZoneFilledLetters.every((letter, i) => letter === targetWord[i]);

    if (!allLettersCorrect) {
      // Slots are full but letters are wrong - player is stuck
      trackWordFailure(targetWord);
      return;
    }

    {
      // Cancel the 15s word timer since word was solved
      if (this.hookZoneWordTimer) {
        this.hookZoneWordTimer.remove();
        this.hookZoneWordTimer = undefined;
      }

      // Track successful word attempt
      trackWordAttempt(targetWord);

      // Mark zone as solved
      this.hookZoneSolved[this.currentHookZoneIndex] = true;

      // Add to completed spell words if it's a spell
      if (this.isSpellWord(targetWord) && !this.completedSpellWords.includes(targetWord)) {
        this.completedSpellWords.push(targetWord);
      }

      // Show completion feedback
      this.time.delayedCall(300, () => {
        this.jumufGiveHint(`"${targetWord}" complete! You've mastered this zone!`);

        // Celebration particles
        for (let i = 0; i < 15; i++) {
          this.time.delayedCall(i * 40, () => {
            this.emitSpark(
              this.player.x + Phaser.Math.Between(-50, 50),
              this.player.y + Phaser.Math.Between(-50, 50)
            );
          });
        }
      });
    }
  }

  private updateCombat(delta: number) {
    // Update cooldowns
    Object.keys(this.combatCooldowns).forEach(key => {
      if (this.combatCooldowns[key as keyof typeof this.combatCooldowns] > 0) {
        this.combatCooldowns[key as keyof typeof this.combatCooldowns] -= delta;
      }
    });

    // Update dash
    if (this.isDashing) {
      this.dashDuration -= delta;
      if (this.dashDuration <= 0) {
        this.isDashing = false;
      }
    }

    // Update familiar
    if (this.familiarActive && this.familiar) {
      this.familiarDuration -= delta;
      if (this.familiarDuration <= 0) {
        this.familiarActive = false;
        this.familiar.destroy();
        this.familiar = undefined;
      } else {
        // Follow player
        const targetX = this.player.x - 30;
        const targetY = this.player.y - 20;
        this.familiar.x = Phaser.Math.Linear(this.familiar.x, targetX, 0.1);
        this.familiar.y = Phaser.Math.Linear(this.familiar.y, targetY, 0.1);
      }
    }

    // Spawn spell-gated enemies once BLAZE is unlocked
    this.ensureSpellGatedEnemySpawns();

    // Update enemies
    this.updateEnemyAI();

    // Update projectiles
    this.updateProjectiles();
    this.updateSnowballs();

    // Check enemy collision with player
    this.checkEnemyPlayerCollision();

    // Handle combat inputs
    if (!this.isTraversing && this.manualControlEnabled) {
      this.handleCombatInputs();
    }

    // Handle T key for FROST pronunciation (if FROST is completed)
    if (this.testKey && Phaser.Input.Keyboard.JustDown(this.testKey)) {
      if (this.completedSpellWords.includes('FROST')) {
        // Start listening for FROST pronunciation
        this.waitingForFrostPronunciation = true;
        this.startListeningForFrost();
      } else {
        // Fallback to test word completion if FROST not completed
        this.testWordCompletion();
      }
    }
  }

  private handleCombatInputs() {
    // Weapon switching (J key) - toggle between wand and sword
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.melee)) {
      this.toggleWeapon();
    }

    // Dash attack
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.dash) && this.combatCooldowns.dash <= 0) {
      this.performDashAttack();
    }

    // Projectile (wand mode only)
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.projectile) && this.combatCooldowns.projectile <= 0 && this.weaponMode === 'wand') {
      this.shootProjectile();
    }

    // Sword barrage (Q key in sword mode - takes priority over BLAZE)
    if (this.weaponMode === 'sword') {
      if (Phaser.Input.Keyboard.JustDown(this.combatKeys.flare) && !this.isBarraging && this.combatCooldowns.flare <= 0) {
        this.startSwordBarrage();
      }
    } else {
      // Elemental abilities (work in wand mode, if word completed)
      if (Phaser.Input.Keyboard.JustDown(this.combatKeys.flare) && this.combatCooldowns.flare <= 0 && this.completedSpellWords.includes('BLAZE')) {
        this.castFlare();
      }
    }
    
    // Other elemental abilities (work in any weapon mode, if word completed)
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.frost) && this.combatCooldowns.frost <= 0 && this.completedSpellWords.includes('FROST')) {
      this.castFrost();
    }
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.storm) && this.combatCooldowns.storm <= 0 && this.completedSpellWords.includes('STORM')) {
      this.castStorm();
    }
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.blind) && this.combatCooldowns.blind <= 0 && this.completedSpellWords.includes('BLIND')) {
      this.castBlind();
    }
    if (Phaser.Input.Keyboard.JustDown(this.combatKeys.hungry) && this.combatCooldowns.hungry <= 0 && this.completedSpellWords.includes('HUNGRY')) {
      this.castHungry();
    }
  }

  // ===========================
  // WEAPON SYSTEM
  // ===========================

  private toggleWeapon() {
    this.weaponMode = this.weaponMode === 'wand' ? 'sword' : 'wand';
    
    const weaponName = this.weaponMode === 'sword' ? '⚔️ SWORD' : '🪄 WAND';
    console.log(`🔄 Switched to ${weaponName} mode!`);
    
    // Visual feedback
    const switchText = this.add.text(this.player.x, this.player.y - 40, weaponName, {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: this.weaponMode === 'sword' ? '#ff6b6b' : '#4ecdc4',
      stroke: '#000000',
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);

    this.tweens.add({
      targets: switchText,
      y: switchText.y - 30,
      alpha: 0,
      duration: 1000,
      ease: 'Power2.easeOut',
      onComplete: () => switchText.destroy()
    });

    // Reset any ongoing barrage
    this.isBarraging = false;
    this.barrageCount = 0;
  }

  private startSwordBarrage() {
    if (this.isBarraging) return;
    
    console.log('⚔️💥 SWORD BARRAGE ACTIVATED!');
    this.isBarraging = true;
    this.barrageCount = 0;
    this.combatCooldowns.flare = 3000; // 3 second cooldown after barrage

    // Barrage text
    const barrageText = this.add.text(this.player.x, this.player.y - 50, '💥 BARRAGE! 💥', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ff4757',
      stroke: '#000000',
      strokeThickness: 3,
    }).setDepth(25).setOrigin(0.5);

    this.tweens.add({
      targets: barrageText,
      scaleX: 1.2,
      scaleY: 1.2,
      alpha: 0,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => barrageText.destroy()
    });

    // Execute barrage attacks
    this.executeBarrageAttack();
  }

  private executeBarrageAttack() {
    if (!this.isBarraging || this.barrageCount >= 8) {
      this.isBarraging = false;
      return;
    }

    this.barrageCount++;
    
    // Alternate between front and behind attacks
    const attackBehind = this.barrageCount % 2 === 0;
    this.performBarrageSlash(attackBehind);

    // Schedule next attack
    this.time.delayedCall(150, () => {
      this.executeBarrageAttack();
    });
  }

  private performBarrageSlash(attackBehind: boolean = false) {
    const direction = attackBehind ? (this.player.flipX ? 1 : -1) : (this.player.flipX ? -1 : 1);
    const slashX = this.player.x + (direction * 50);
    const slashY = this.player.y;

    // Create sword visual effect
    const sword = this.add.graphics().setDepth(15);
    
    // Draw sword blade (silver with red glow for barrage)
    sword.fillStyle(0xff4757, 1);
    sword.fillRect(slashX - 6, slashY - 30, 12, 45);
    
    // Draw sword hilt
    sword.fillStyle(0x8b4513, 1);
    sword.fillRect(slashX - 4, slashY + 15, 8, 12);
    
    // Draw sword guard (gold)
    sword.fillStyle(0xffd700, 1);
    sword.fillRect(slashX - 10, slashY + 10, 20, 4);

    // Sword slash animation
    this.tweens.add({
      targets: sword,
      rotation: direction * Math.PI / 3,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 200,
      ease: 'Power2.easeOut',
      onComplete: () => sword.destroy()
    });

    // Create slash trail effect (red for barrage)
    const slashTrail = this.add.rectangle(slashX, slashY, 100, 60, 0xff4757, 0.7)
      .setDepth(14);

    this.tweens.add({
      targets: slashTrail,
      scaleX: 1.8,
      scaleY: 1.8,
      alpha: 0,
      duration: 150,
      ease: 'Power2.easeOut',
      onComplete: () => slashTrail.destroy()
    });

    // Check enemy hits - increased damage and range for barrage
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        const distance = Phaser.Math.Distance.Between(slashX, slashY, enemy.sprite.x, enemy.sprite.y);
        if (distance < 80) {
          this.damageEnemy(enemy, 2, 'SWORD'); // Double damage during barrage
        }
      }
    });

    // Check demon hits with increased damage
    if (this.demons) {
      this.demons.forEach(demon => {
        if (!demon.isStunned) {
          const distance = Phaser.Math.Distance.Between(slashX, slashY, demon.sprite.x, demon.sprite.y);
          if (distance < 80) {
            this.damageDemon(demon, 150); // Increased damage for barrage
          }
        }
      });
    }

    console.log(`⚔️ Barrage slash ${this.barrageCount}/8 ${attackBehind ? 'BEHIND' : 'FRONT'}!`);
  }

  // ===========================
  // BASIC COMBAT ABILITIES
  // ===========================

  private performSlash() {
    console.log('⚔️ Sword slash!');
    this.combatCooldowns.melee = 500;

    const direction = this.player.flipX ? -1 : 1;
    const slashX = this.player.x + (direction * 40);
    const slashY = this.player.y;

    // Create sword visual effect
    const sword = this.add.graphics()
      .setDepth(15);
    
    // Draw sword blade (silver)
    sword.fillStyle(0xc0c0c0, 1);
    sword.fillRect(slashX - 5, slashY - 25, 10, 40);
    
    // Draw sword hilt (brown)
    sword.fillStyle(0x8b4513, 1);
    sword.fillRect(slashX - 3, slashY + 15, 6, 10);
    
    // Draw sword guard (gold)
    sword.fillStyle(0xffd700, 1);
    sword.fillRect(slashX - 8, slashY + 10, 16, 3);

    // Sword slash animation
    this.tweens.add({
      targets: sword,
      rotation: direction * Math.PI / 4,
      scaleX: 1.2,
      scaleY: 1.2,
      alpha: 0,
      duration: 300,
      ease: 'Power2.easeOut',
      onComplete: () => sword.destroy()
    });

    // Create slash trail effect
    const slashTrail = this.add.rectangle(slashX, slashY, 80, 50, 0xffffff, 0.6)
      .setDepth(14);

    this.tweens.add({
      targets: slashTrail,
      scaleX: 1.5,
      scaleY: 1.5,
      alpha: 0,
      duration: 200,
      ease: 'Power2.easeOut',
      onComplete: () => slashTrail.destroy()
    });

    // Check enemy hits - 100 damage to demons, 1 damage to regular enemies
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        const distance = Phaser.Math.Distance.Between(slashX, slashY, enemy.sprite.x, enemy.sprite.y);
        if (distance < 60) {
          this.damageEnemy(enemy, 1, 'SWORD');
        }
      }
    });

    // Check demon hits with 100 damage
    if (this.demons) {
      this.demons.forEach(demon => {
        if (!demon.isStunned) {
          const distance = Phaser.Math.Distance.Between(slashX, slashY, demon.sprite.x, demon.sprite.y);
          if (distance < 60) {
            this.damageDemon(demon, 100);
          }
        }
      });
    }
  }

  private performDashAttack() {
    console.log('💨 Dash attack!');
    this.combatCooldowns.dash = 800;
    this.isDashing = true;
    this.dashDuration = 300;

    const direction = this.player.flipX ? -1 : 1;
    const dashSpeed = 400;

    // Apply dash velocity
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setVelocityX(direction * dashSpeed);

    // Create dash trail
    for (let i = 0; i < 5; i++) {
      this.time.delayedCall(i * 50, () => {
        const trail = this.add.rectangle(this.player.x, this.player.y, 24, 28, 0x60a5fa, 0.5)
          .setDepth(4);
        this.tweens.add({
          targets: trail,
          alpha: 0,
          duration: 200,
          onComplete: () => trail.destroy()
        });
      });
    }

    // Check enemy hits during dash
    const dashHitCheck = this.time.addEvent({
      delay: 50,
      repeat: 5,
      callback: () => {
        this.enemies.forEach(enemy => {
          if (!enemy.isDead) {
            const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
            if (distance < 40) {
              this.damageEnemy(enemy, 2);
            }
          }
        });
      }
    });
  }

  private shootProjectile() {
    console.log('🌟 Magic shuriken!');
    this.combatCooldowns.projectile = 600;

    const direction = this.player.flipX ? -1 : 1;
    const projectile = this.add.image(this.player.x, this.player.y - 10, 'magic_shuriken')
      .setDepth(10);

    this.physics.add.existing(projectile);
    const projBody = projectile.body as Phaser.Physics.Arcade.Body;
    projBody.setAllowGravity(false);
    projBody.setVelocityX(direction * 400);

    // Add spinning animation to shuriken
    this.tweens.add({
      targets: projectile,
      rotation: direction * Math.PI * 4, // 2 full rotations
      duration: 2000,
      ease: 'Linear'
    });

    this.projectiles.push(projectile);

    // Remove after 3 seconds
    this.time.delayedCall(3000, () => {
      const index = this.projectiles.indexOf(projectile);
      if (index > -1) {
        this.projectiles.splice(index, 1);
        projectile.destroy();
      }
    });
  }

  // ===========================
  // ELEMENTAL ABILITIES
  // ===========================

  private castFlare() {
    console.log('🔥 FLARE - Fire burst AoE!');
    this.combatCooldowns.flare = 4000; // 4 second cooldown

    // Create expanding fire burst effect
    const burst = this.add.circle(this.player.x, this.player.y, 50, 0xff4500, 0.8)
      .setDepth(20);

    this.tweens.add({
      targets: burst,
      scale: 6, // Expand to 300px radius
      alpha: 0,
      duration: 600,
      ease: 'Power2.easeOut',
      onComplete: () => burst.destroy()
    });

    // Inner orange burst
    const innerBurst = this.add.circle(this.player.x, this.player.y, 30, 0xff6600, 0.9)
      .setDepth(21);

    this.tweens.add({
      targets: innerBurst,
      scale: 4,
      alpha: 0,
      duration: 400,
      ease: 'Power2.easeOut',
      onComplete: () => innerBurst.destroy()
    });

    // Fire particles
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      const distance = 80 + Math.random() * 200; // Spread across 300px radius
      const particle = this.add.rectangle(
        this.player.x + Math.cos(angle) * distance,
        this.player.y + Math.sin(angle) * distance,
        Math.random() * 8 + 4, Math.random() * 8 + 4, 
        Math.random() > 0.5 ? 0xff4500 : 0xff6600
      ).setDepth(25);

      this.tweens.add({
        targets: particle,
        alpha: 0,
        scale: 0.1,
        y: particle.y - Math.random() * 30,
        duration: 500 + Math.random() * 300,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }

    // Damage and knockback enemies within 300px
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 300) {
          // Damage enemy
          this.damageEnemy(enemy, 4); // High damage

          // Knockback effect
          const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
          const knockbackForce = 150;
          const knockbackX = Math.cos(angle) * knockbackForce;
          const knockbackY = Math.sin(angle) * knockbackForce;

          // Apply knockback
          this.tweens.add({
            targets: enemy.sprite,
            x: enemy.sprite.x + knockbackX,
            y: enemy.sprite.y + knockbackY,
            duration: 300,
            ease: 'Power2.easeOut'
          });

          // Fire tint effect
          enemy.sprite.setTint(0xff4500);
          this.time.delayedCall(200, () => {
            if (!enemy.isDead) {
              enemy.sprite.clearTint();
            }
          });
        }
      }
    });

    // Damage and knockback demons within 300px
    this.demons.forEach(demon => {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
      if (distance <= 300) {
        // Damage demon
        demon.health -= 2;
        if (demon.health <= 0) {
          demon.sprite.setTint(0x444444);
          demon.sprite.setAlpha(0.5);
        }

        // Knockback effect
        const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
        const knockbackForce = 150;
        const knockbackX = Math.cos(angle) * knockbackForce;
        const knockbackY = Math.sin(angle) * knockbackForce;

        // Apply knockback
        this.tweens.add({
          targets: demon.sprite,
          x: demon.sprite.x + knockbackX,
          y: demon.sprite.y + knockbackY,
          duration: 300,
          ease: 'Power2.easeOut'
        });

        // Fire tint effect
        demon.sprite.setTint(0xff4500);
        this.time.delayedCall(200, () => {
          demon.sprite.clearTint();
        });
      }
    });
  }

  private castFrost() {
    console.log('❄️ FROST - Freeze enemies!');
    this.combatCooldowns.frost = 6000; // 6 second cooldown

    // Blue pulse effect
    const pulse = this.add.circle(this.player.x, this.player.y, 50, 0x00bfff, 0.8)
      .setDepth(20);

    this.tweens.add({
      targets: pulse,
      scale: 8, // Expand to 400px radius
      alpha: 0,
      duration: 800,
      ease: 'Power2.easeOut',
      onComplete: () => pulse.destroy()
    });

    // Create frost particles
    for (let i = 0; i < 30; i++) {
      const angle = (i / 30) * Math.PI * 2;
      const distance = 100 + Math.random() * 250; // Spread across the radius
      const particle = this.add.rectangle(
        this.player.x + Math.cos(angle) * distance,
        this.player.y + Math.sin(angle) * distance,
        6, 6, 0x87ceeb
      ).setDepth(25);

      this.tweens.add({
        targets: particle,
        alpha: 0,
        scale: 0.3,
        y: particle.y - 20,
        duration: 600,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }

    // Freeze enemies within 400px radius (as specified: 350-400px range means up to 400px)
    this.enemies.forEach(enemy => {
      if (!enemy.isDead && !enemy.sprite.getData('isFrozen')) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 400) {
          if (enemy.enemyType === 'fire') {
            this.freezeFireDemon(enemy, 10000);
            return;
          }

          // Store original properties
          const originalSpeed = enemy.speed || 1;
          
          // Apply freeze
          enemy.sprite.setData('isFrozen', true);
          enemy.sprite.setData('originalSpeed', originalSpeed);
          
          // Stop movement
          enemy.speed = 0;
          
          // Tint blue
          enemy.sprite.setTint(0x87ceeb);

          // Thaw after 10 seconds
          this.time.delayedCall(10000, () => {
            if (!enemy.isDead && enemy.sprite.getData('isFrozen')) {
              enemy.sprite.setData('isFrozen', false);
              enemy.sprite.clearTint();
              
              // Restore original properties
              enemy.speed = enemy.sprite.getData('originalSpeed');
            }
          });
        }
      }
    });

    // Freeze demons within 400px radius
    this.demons.forEach(demon => {
      if (!demon.sprite.getData('isFrozen')) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
        if (distance <= 400) {
          // Store original properties
          const originalSpeed = demon.chaseSpeed || 1;
          const originalAttackCooldown = demon.attackCooldown || 0;
          
          // Apply freeze
          demon.sprite.setData('isFrozen', true);
          demon.sprite.setData('originalSpeed', originalSpeed);
          demon.sprite.setData('originalAttackCooldown', originalAttackCooldown);
          
          // Stop movement and attacks
          demon.chaseSpeed = 0;
          demon.attackCooldown = 999999;
          
          // Tint blue
          demon.sprite.setTint(0x87ceeb);

          // Thaw after 10 seconds
          this.time.delayedCall(10000, () => {
            if (demon.sprite.getData('isFrozen')) {
              demon.sprite.setData('isFrozen', false);
              demon.sprite.clearTint();
              
              // Restore original properties
              demon.chaseSpeed = demon.sprite.getData('originalSpeed');
              demon.attackCooldown = demon.sprite.getData('originalAttackCooldown');
            }
          });
        }
      }
    });
  }

  private launchHugeFrostAttack() {
    console.log('❄️💥 HUGE FROST ATTACK LAUNCHED!');
    
    const playerX = this.player.x;
    const playerY = this.player.y;
    
    // Massive blue pulse effect
    const hugePulse = this.add.circle(playerX, playerY, 100, 0x00bfff, 0.9)
      .setDepth(20);

    this.tweens.add({
      targets: hugePulse,
      scale: 15, // Expand to 1500px radius (huge!)
      alpha: 0,
      duration: 1200,
      ease: 'Power2.easeOut',
      onComplete: () => hugePulse.destroy()
    });

    // Create massive frost particles (100 instead of 30)
    for (let i = 0; i < 100; i++) {
      const angle = (i / 100) * Math.PI * 2;
      const distance = 200 + Math.random() * 600; // Much larger spread
      const particle = this.add.rectangle(
        playerX + Math.cos(angle) * distance,
        playerY + Math.sin(angle) * distance,
        10, 10, 0x87ceeb
      ).setDepth(25);

      this.tweens.add({
        targets: particle,
        alpha: 0,
        scale: 0.2,
        y: particle.y - 40,
        duration: 1000,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }

    // Multiple expanding frost rings
    for (let ring = 0; ring < 5; ring++) {
      const frostRing = this.add.circle(playerX, playerY, 50, 0x87ceeb, 0.7)
        .setDepth(24);

      this.time.delayedCall(ring * 150, () => {
        this.tweens.add({
          targets: frostRing,
          scale: 20 + ring * 2, // Massive rings
          alpha: 0,
          duration: 1500,
          ease: 'Power2.easeOut',
          onComplete: () => frostRing.destroy()
        });
      });
    }

    // Freeze ALL enemies within 1500px radius (huge range!)
    this.enemies.forEach(enemy => {
      if (!enemy.isDead && !enemy.sprite.getData('isFrozen')) {
        const distance = Phaser.Math.Distance.Between(playerX, playerY, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 1500) {
          if (enemy.enemyType === 'fire') {
            this.freezeFireDemon(enemy, 15000);
            return;
          }

          // Store original properties
          const originalSpeed = enemy.speed || 1;
          
          // Apply freeze
          enemy.sprite.setData('isFrozen', true);
          enemy.sprite.setData('originalSpeed', originalSpeed);
          
          // Stop movement
          enemy.speed = 0;
          
          // Tint blue
          enemy.sprite.setTint(0x87ceeb);

          // Thaw after 15 seconds (longer freeze)
          this.time.delayedCall(15000, () => {
            if (!enemy.isDead && enemy.sprite.getData('isFrozen')) {
              enemy.sprite.setData('isFrozen', false);
              enemy.sprite.clearTint();
              
              // Restore original properties
              enemy.speed = enemy.sprite.getData('originalSpeed');
            }
          });
        }
      }
    });

    // Freeze ALL demons within 1500px radius
    if (this.demons) {
      this.demons.forEach(demon => {
        if (!demon.sprite.getData('isFrozen')) {
          const distance = Phaser.Math.Distance.Between(playerX, playerY, demon.sprite.x, demon.sprite.y);
          if (distance <= 1500) {
            // Store original properties
            const originalSpeed = demon.chaseSpeed || 1;
            const originalAttackCooldown = demon.attackCooldown || 0;
            
            // Apply freeze
            demon.sprite.setData('isFrozen', true);
            demon.sprite.setData('originalSpeed', originalSpeed);
            demon.sprite.setData('originalAttackCooldown', originalAttackCooldown);
            
            // Stop movement and attacks
            demon.chaseSpeed = 0;
            demon.attackCooldown = 999999;
            
            // Tint blue
            demon.sprite.setTint(0x87ceeb);

            // Thaw after 15 seconds (longer freeze)
            this.time.delayedCall(15000, () => {
              if (demon.sprite.getData('isFrozen')) {
                demon.sprite.setData('isFrozen', false);
                demon.sprite.clearTint();
                
                // Restore original properties
                demon.chaseSpeed = demon.sprite.getData('originalSpeed');
                demon.attackCooldown = demon.sprite.getData('originalAttackCooldown');
              }
            });
          }
        }
      });
    }

    // Screen flash effect
    this.cameras.main.flash(600, 135, 206, 250, false);
    
    // Huge frost text
    const hugeFrostText = this.add.text(playerX, playerY - 80, '❄️ HUGE FROST! ❄️', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#87ceeb',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: hugeFrostText,
      scale: 1.5,
      alpha: 0,
      y: hugeFrostText.y - 50,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => hugeFrostText.destroy()
    });
  }

  private launchFrostBlizzardStun() {
    console.log('❄️💨 FROST BLIZZARD STUN - Freezing ALL enemies for 15 seconds!');
    
    const playerX = this.player.x;
    const playerY = this.player.y;

    // Create ice crystal textures if they don't exist
    if (!this.textures.exists('ice_crystal')) {
      const g = this.add.graphics();
      // Draw ice crystal (diamond shape with glow)
      g.fillStyle(0x87ceeb, 0.9);
      g.fillRect(0, 0, 24, 24);
      g.fillStyle(0xb0e0e6, 1);
      g.fillRect(4, 4, 16, 16);
      g.fillStyle(0xe0f7fa, 1);
      g.fillRect(8, 8, 8, 8);
      g.lineStyle(2, 0xffffff, 1);
      g.strokeRect(0, 0, 24, 24);
      g.generateTexture('ice_crystal', 24, 24);
      g.destroy();
    }

    // Create blizzard effect - snow particles falling across screen
    for (let i = 0; i < 200; i++) {
      const snowX = Phaser.Math.Between(0, this.cameras.main.width);
      const snowY = Phaser.Math.Between(-100, -20);
      const snowflake = this.add.circle(snowX, snowY, Phaser.Math.Between(2, 5), 0xffffff, 0.8)
        .setDepth(50)
        .setScrollFactor(0);
      
      this.tweens.add({
        targets: snowflake,
        y: this.cameras.main.height + 100,
        x: snowX + Phaser.Math.Between(-50, 50),
        duration: Phaser.Math.Between(3000, 6000),
        ease: 'Linear',
        onComplete: () => snowflake.destroy()
      });
    }

    // Massive expanding frost wave
    const frostWave = this.add.circle(playerX, playerY, 50, 0x87ceeb, 0.9)
      .setDepth(20);

    this.tweens.add({
      targets: frostWave,
      scale: 30, // Cover entire screen
      alpha: 0,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => frostWave.destroy()
    });

    // Multiple expanding frost rings
    for (let ring = 0; ring < 8; ring++) {
      const frostRing = this.add.circle(playerX, playerY, 50, 0x87ceeb, 0.7)
        .setDepth(24);

      this.time.delayedCall(ring * 100, () => {
        this.tweens.add({
          targets: frostRing,
          scale: 25 + ring * 2,
          alpha: 0,
          duration: 2000,
          ease: 'Power2.easeOut',
          onComplete: () => frostRing.destroy()
        });
      });
    }

    // Freeze ALL enemies (no distance check)
    this.enemies.forEach(enemy => {
      if (!enemy.isDead && !enemy.sprite.getData('isFrozen')) {
        if (enemy.enemyType === 'fire') {
          this.freezeFireDemon(enemy, 15000);
          return;
        }

        // Store original properties
        const originalSpeed = enemy.speed || 1;
        
        // Apply freeze
        enemy.sprite.setData('isFrozen', true);
        enemy.sprite.setData('originalSpeed', originalSpeed);
        
        // Stop movement
        enemy.speed = 0;
        
        // Tint blue/ice
        enemy.sprite.setTint(0x87ceeb);
        
        // Create ice block sprite on enemy
        const iceBlock = this.add.image(enemy.sprite.x, enemy.sprite.y, 'ice_crystal')
          .setDepth(enemy.sprite.depth + 1)
          .setScale(1.5)
          .setAlpha(0.8);
        
        // Store ice block reference
        enemy.sprite.setData('iceBlock', iceBlock);
        
        // Animate ice block appearance
        iceBlock.setScale(0);
        this.tweens.add({
          targets: iceBlock,
          scale: 1.5,
          duration: 300,
          ease: 'Back.easeOut'
        });

        // Thaw after 15 seconds
        this.time.delayedCall(15000, () => {
          if (!enemy.isDead && enemy.sprite.getData('isFrozen')) {
            enemy.sprite.setData('isFrozen', false);
            enemy.sprite.clearTint();
            
            // Remove ice block
            const ice = enemy.sprite.getData('iceBlock');
            if (ice) {
              this.tweens.add({
                targets: ice,
                alpha: 0,
                scale: 0,
                duration: 200,
                onComplete: () => ice.destroy()
              });
            }
            
            // Restore original properties
            enemy.speed = enemy.sprite.getData('originalSpeed');
          }
        });
      }
    });

    // Freeze ALL demons (no distance check)
    if (this.demons) {
      this.demons.forEach(demon => {
        if (!demon.sprite.getData('isFrozen')) {
          // Store original properties
          const originalSpeed = demon.chaseSpeed || 1;
          const originalAttackCooldown = demon.attackCooldown || 0;
          
          // Apply freeze
          demon.sprite.setData('isFrozen', true);
          demon.sprite.setData('originalSpeed', originalSpeed);
          demon.sprite.setData('originalAttackCooldown', originalAttackCooldown);
          
          // Stop movement and attacks
          demon.chaseSpeed = 0;
          demon.attackCooldown = 999999;
          
          // Tint blue/ice
          demon.sprite.setTint(0x87ceeb);
          
          // Create ice block sprite on demon
          const iceBlock = this.add.image(demon.sprite.x, demon.sprite.y, 'ice_crystal')
            .setDepth(demon.sprite.depth + 1)
            .setScale(1.5)
            .setAlpha(0.8);
          
          // Store ice block reference
          demon.sprite.setData('iceBlock', iceBlock);
          
          // Animate ice block appearance
          iceBlock.setScale(0);
          this.tweens.add({
            targets: iceBlock,
            scale: 1.5,
            duration: 300,
            ease: 'Back.easeOut'
          });

          // Thaw after 15 seconds
          this.time.delayedCall(15000, () => {
            if (demon.sprite.getData('isFrozen')) {
              demon.sprite.setData('isFrozen', false);
              demon.sprite.clearTint();
              
              // Remove ice block
              const ice = demon.sprite.getData('iceBlock');
              if (ice) {
                this.tweens.add({
                  targets: ice,
                  alpha: 0,
                  scale: 0,
                  duration: 200,
                  onComplete: () => ice.destroy()
                });
              }
              
              // Restore original properties
              demon.chaseSpeed = demon.sprite.getData('originalSpeed');
              demon.attackCooldown = demon.sprite.getData('originalAttackCooldown');
            }
          });
        }
      });
    }

    // Screen flash effect (blue/white)
    this.cameras.main.flash(800, 135, 206, 250, false);
    
    // FROST STUN text
    const frostStunText = this.add.text(playerX, playerY - 80, '❄️ BLIZZARD STUN! ❄️', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#87ceeb',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: frostStunText,
      scale: 1.5,
      alpha: 0,
      y: frostStunText.y - 50,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => frostStunText.destroy()
    });
  }

  private launchFlareStun() {
    console.log('🔥💥 BLAZE STUN - Scorching ALL enemies!');
    
    const playerX = this.player.x;
    const playerY = this.player.y;

    // Create fire texture if it doesn't exist
    if (!this.textures.exists('fire_particle')) {
      const g = this.add.graphics();
      // Draw fire particle (orange/red gradient)
      g.fillStyle(0xff6600, 1);
      g.fillRect(0, 0, 16, 16);
      g.fillStyle(0xff4500, 0.8);
      g.fillRect(2, 2, 12, 12);
      g.fillStyle(0xff0000, 0.6);
      g.fillRect(4, 4, 8, 8);
      g.fillStyle(0xffff00, 0.4);
      g.fillRect(6, 6, 4, 4);
      g.generateTexture('fire_particle', 16, 16);
      g.destroy();
    }

    // Create charred/black texture for demons
    if (!this.textures.exists('charred_demon')) {
      const g = this.add.graphics();
      g.fillStyle(0x1a1a1a, 1); // Very dark/black
      g.fillRect(0, 0, 32, 32);
      g.fillStyle(0x2d2d2d, 0.8);
      g.fillRect(2, 2, 28, 28);
      g.generateTexture('charred_demon', 32, 32);
      g.destroy();
    }

    // Massive expanding fire wave
    const fireWave = this.add.circle(playerX, playerY, 50, 0xff4500, 0.9)
      .setDepth(20);

    this.tweens.add({
      targets: fireWave,
      scale: 30, // Cover entire screen
      alpha: 0,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => fireWave.destroy()
    });

    // Multiple expanding fire rings
    for (let ring = 0; ring < 8; ring++) {
      const fireRing = this.add.circle(playerX, playerY, 50, 0xff6600, 0.7)
        .setDepth(24);

      this.time.delayedCall(ring * 100, () => {
        this.tweens.add({
          targets: fireRing,
          scale: 25 + ring * 2,
          alpha: 0,
          duration: 2000,
          ease: 'Power2.easeOut',
          onComplete: () => fireRing.destroy()
        });
      });
    }

    // Fire particles raining down
    for (let i = 0; i < 150; i++) {
      const fireX = Phaser.Math.Between(0, this.cameras.main.width);
      const fireY = Phaser.Math.Between(-100, -20);
      const fireParticle = this.add.image(fireX, fireY, 'fire_particle')
        .setDepth(50)
        .setScrollFactor(0)
        .setScale(Phaser.Math.FloatBetween(0.5, 1.5));
      
      this.tweens.add({
        targets: fireParticle,
        y: this.cameras.main.height + 100,
        x: fireX + Phaser.Math.Between(-30, 30),
        rotation: Phaser.Math.FloatBetween(0, Math.PI * 2),
        alpha: 0,
        duration: Phaser.Math.Between(2000, 4000),
        ease: 'Power2.easeIn',
        onComplete: () => fireParticle.destroy()
      });
    }

    // Scorch ALL enemies (no distance check)
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        // Apply scorch effect
        enemy.sprite.setData('isScorched', true);
        
        // Tint red/orange (fire effect)
        enemy.sprite.setTint(0xff4500);
        
        // Create fire sprite on enemy
        const fireEffect = this.add.image(enemy.sprite.x, enemy.sprite.y - 10, 'fire_particle')
          .setDepth(enemy.sprite.depth + 1)
          .setScale(1.2)
          .setAlpha(0.9);
        
        // Store fire effect reference
        enemy.sprite.setData('fireEffect', fireEffect);
        
        // Animate fire effect
        fireEffect.setScale(0);
        this.tweens.add({
          targets: fireEffect,
          scale: 1.2,
          duration: 300,
          ease: 'Back.easeOut'
        });

        // Pulsing fire animation
        this.tweens.add({
          targets: fireEffect,
          scale: { from: 1.2, to: 1.5 },
          alpha: { from: 0.9, to: 0.6 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });

        // Damage enemy (scorch damage)
        this.damageEnemy(enemy, 3);
      }
    });

    // Scorch ALL demons (no distance check)
    if (this.demons) {
      this.demons.forEach(demon => {
        // Damage demon
        demon.health -= 5;
        
        // If demon doesn't die, turn charred/black
        if (demon.health > 0) {
          // Store original tint
          if (!demon.sprite.getData('originalTint')) {
            demon.sprite.setData('originalTint', demon.sprite.tint);
          }
          
          // Turn charred/black
          demon.sprite.setTint(0x1a1a1a); // Very dark/black
          demon.sprite.setData('isCharred', true);
          
          // Create charred overlay
          const charredOverlay = this.add.image(demon.sprite.x, demon.sprite.y, 'charred_demon')
            .setDepth(demon.sprite.depth + 1)
            .setScale(demon.sprite.scaleX, demon.sprite.scaleY)
            .setAlpha(0.7)
            .setBlendMode(Phaser.BlendModes.MULTIPLY);
          
          // Store charred overlay reference
          demon.sprite.setData('charredOverlay', charredOverlay);
          
          // Animate charred appearance
          charredOverlay.setScale(0);
          this.tweens.add({
            targets: charredOverlay,
            scaleX: demon.sprite.scaleX,
            scaleY: demon.sprite.scaleY,
            duration: 400,
            ease: 'Back.easeOut'
          });
        } else {
          // Demon dies - kill it
          this.killDemon(demon);
        }
      });
    }

    // Screen flash effect (orange/red)
    this.cameras.main.flash(800, 255, 69, 0, false);
    
    // BLAZE STUN text
    const flareStunText = this.add.text(playerX, playerY - 80, '🔥 BLAZE STUN! 🔥', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#ff4500',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: flareStunText,
      scale: 1.5,
      alpha: 0,
      y: flareStunText.y - 50,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => flareStunText.destroy()
    });
  }

  private launchStormStun() {
    console.log('⚡💥 STORM STUN - Electrocuting ALL enemies!');
    
    const playerX = this.player.x;
    const playerY = this.player.y;

    // Create lightning texture if it doesn't exist
    if (!this.textures.exists('lightning_bolt')) {
      const g = this.add.graphics();
      // Draw lightning bolt (jagged white/yellow)
      g.lineStyle(4, 0xffffff, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(5, 10);
      g.lineTo(-3, 15);
      g.lineTo(4, 20);
      g.lineTo(-2, 25);
      g.lineTo(3, 30);
      g.strokePath();
      g.lineStyle(6, 0xffff00, 0.6);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(5, 10);
      g.lineTo(-3, 15);
      g.lineTo(4, 20);
      g.lineTo(-2, 25);
      g.lineTo(3, 30);
      g.strokePath();
      g.generateTexture('lightning_bolt', 10, 30);
      g.destroy();
    }

    // Create shock/electrical texture
    if (!this.textures.exists('shock_effect')) {
      const g = this.add.graphics();
      // Draw electrical shock (zigzag pattern)
      g.lineStyle(3, 0x00ffff, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(8, 8);
      g.lineTo(-4, 12);
      g.lineTo(6, 16);
      g.lineTo(-3, 20);
      g.lineTo(5, 24);
      g.strokePath();
      g.generateTexture('shock_effect', 12, 24);
      g.destroy();
    }

    // Massive lightning strike from sky to player
    const skyY = playerY - 600;
    const lightningStrike = this.add.graphics().setDepth(30);
    lightningStrike.lineStyle(8, 0xffffff, 1);
    lightningStrike.beginPath();
    lightningStrike.moveTo(playerX, skyY);
    
    // Create jagged lightning path
    const segments = 15;
    const deltaY = (playerY - skyY) / segments;
    let currentX = playerX;
    let currentY = skyY;
    
    for (let i = 1; i <= segments; i++) {
      currentX = playerX + (Math.random() - 0.5) * 40;
      currentY = skyY + deltaY * i;
      lightningStrike.lineTo(currentX, currentY);
    }
    lightningStrike.lineTo(playerX, playerY);
    lightningStrike.strokePath();
    
    // Yellow glow
    const glow = this.add.graphics().setDepth(29);
    glow.lineStyle(12, 0xffff00, 0.6);
    glow.beginPath();
    glow.moveTo(playerX, skyY);
    glow.lineTo(playerX, playerY);
    glow.strokePath();

    // Remove lightning after short time
    this.time.delayedCall(300, () => {
      lightningStrike.destroy();
      glow.destroy();
    });

    // Expanding electrical wave
    const electricWave = this.add.circle(playerX, playerY, 50, 0x00ffff, 0.9)
      .setDepth(20);

    this.tweens.add({
      targets: electricWave,
      scale: 30, // Cover entire screen
      alpha: 0,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => electricWave.destroy()
    });

    // Multiple expanding electric rings
    for (let ring = 0; ring < 8; ring++) {
      const electricRing = this.add.circle(playerX, playerY, 50, 0x00ffff, 0.7)
        .setDepth(24);

      this.time.delayedCall(ring * 100, () => {
        this.tweens.add({
          targets: electricRing,
          scale: 25 + ring * 2,
          alpha: 0,
          duration: 2000,
          ease: 'Power2.easeOut',
          onComplete: () => electricRing.destroy()
        });
      });
    }

    // Electrocute ALL enemies (no distance check)
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        // Store original properties
        const originalSpeed = enemy.speed || 1;
        
        // Apply paralysis
        enemy.sprite.setData('isParalyzed', true);
        enemy.sprite.setData('originalSpeed', originalSpeed);
        
        // Stop movement
        enemy.speed = 0;
        
        // Tint blue/cyan (electric effect)
        enemy.sprite.setTint(0x00ffff);
        
        // Create lightning bolt on enemy
        const lightningBolt = this.add.image(enemy.sprite.x, enemy.sprite.y - 15, 'lightning_bolt')
          .setDepth(enemy.sprite.depth + 1)
          .setScale(1.5)
          .setAlpha(0.9)
          .setRotation(Math.random() * Math.PI * 2);
        
        // Store lightning bolt reference
        enemy.sprite.setData('lightningBolt', lightningBolt);
        
        // Animate lightning bolt appearance
        lightningBolt.setScale(0);
        this.tweens.add({
          targets: lightningBolt,
          scale: 1.5,
          duration: 200,
          ease: 'Back.easeOut'
        });

        // Pulsing electrical animation
        this.tweens.add({
          targets: lightningBolt,
          alpha: { from: 0.9, to: 0.4 },
          scale: { from: 1.5, to: 1.8 },
          duration: 300,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut'
        });

        // Create shock effect particles
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2;
          const shock = this.add.image(
            enemy.sprite.x + Math.cos(angle) * 20,
            enemy.sprite.y + Math.sin(angle) * 20,
            'shock_effect'
          )
            .setDepth(enemy.sprite.depth + 1)
            .setScale(0.8)
            .setAlpha(0.7)
            .setRotation(angle);
          
          this.tweens.add({
            targets: shock,
            alpha: 0,
            scale: 0.3,
            duration: 1000,
            ease: 'Power2.easeOut',
            onComplete: () => shock.destroy()
          });
        }

        // Damage enemy (electrocution damage)
        this.damageEnemy(enemy, 2);

        // Remove paralysis after 10 seconds
        this.time.delayedCall(10000, () => {
          if (!enemy.isDead && enemy.sprite.getData('isParalyzed')) {
            enemy.sprite.setData('isParalyzed', false);
            enemy.sprite.clearTint();
            
            // Remove lightning bolt
            const bolt = enemy.sprite.getData('lightningBolt');
            if (bolt) {
              this.tweens.add({
                targets: bolt,
                alpha: 0,
                scale: 0,
                duration: 200,
                onComplete: () => bolt.destroy()
              });
            }
            
            // Restore original properties
            enemy.speed = enemy.sprite.getData('originalSpeed');
          }
        });
      }
    });

    // Electrocute ALL demons (no distance check)
    if (this.demons) {
      this.demons.forEach(demon => {
        // Random chance: 50% die immediately, 50% paralyzed
        const shouldDie = Math.random() < 0.5;
        
        if (shouldDie) {
          // Kill demon immediately
          demon.health = 0;
          this.killDemon(demon);
        } else {
          // Paralyze demon temporarily
          demon.health -= 3; // Some damage but not death
          
          // Store original properties
          const originalSpeed = demon.chaseSpeed || 1;
          const originalAttackCooldown = demon.attackCooldown || 0;
          
          // Apply paralysis
          demon.sprite.setData('isParalyzed', true);
          demon.sprite.setData('originalSpeed', originalSpeed);
          demon.sprite.setData('originalAttackCooldown', originalAttackCooldown);
          
          // Stop movement and attacks
          demon.chaseSpeed = 0;
          demon.attackCooldown = 999999;
          
          // Tint blue/cyan (electric effect)
          demon.sprite.setTint(0x00ffff);
          
          // Create lightning bolt on demon
          const lightningBolt = this.add.image(demon.sprite.x, demon.sprite.y - 15, 'lightning_bolt')
            .setDepth(demon.sprite.depth + 1)
            .setScale(1.5)
            .setAlpha(0.9)
            .setRotation(Math.random() * Math.PI * 2);
          
          // Store lightning bolt reference
          demon.sprite.setData('lightningBolt', lightningBolt);
          
          // Animate lightning bolt appearance
          lightningBolt.setScale(0);
          this.tweens.add({
            targets: lightningBolt,
            scale: 1.5,
            duration: 200,
            ease: 'Back.easeOut'
          });

          // Pulsing electrical animation
          this.tweens.add({
            targets: lightningBolt,
            alpha: { from: 0.9, to: 0.4 },
            scale: { from: 1.5, to: 1.8 },
            duration: 300,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
          });

          // Create shock effect particles
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const shock = this.add.image(
              demon.sprite.x + Math.cos(angle) * 20,
              demon.sprite.y + Math.sin(angle) * 20,
              'shock_effect'
            )
              .setDepth(demon.sprite.depth + 1)
              .setScale(0.8)
              .setAlpha(0.7)
              .setRotation(angle);
            
            this.tweens.add({
              targets: shock,
              alpha: 0,
              scale: 0.3,
              duration: 1000,
              ease: 'Power2.easeOut',
              onComplete: () => shock.destroy()
            });
          }

          // Remove paralysis after 10 seconds
          this.time.delayedCall(10000, () => {
            if (demon.sprite.getData('isParalyzed')) {
              demon.sprite.setData('isParalyzed', false);
              demon.sprite.clearTint();
              
              // Remove lightning bolt
              const bolt = demon.sprite.getData('lightningBolt');
              if (bolt) {
                this.tweens.add({
                  targets: bolt,
                  alpha: 0,
                  scale: 0,
                  duration: 200,
                  onComplete: () => bolt.destroy()
                });
              }
              
              // Restore original properties
              demon.chaseSpeed = demon.sprite.getData('originalSpeed');
              demon.attackCooldown = demon.sprite.getData('originalAttackCooldown');
            }
          });
        }
      });
    }

    // Screen flash effect (white/cyan)
    this.cameras.main.flash(800, 255, 255, 255, false);
    
    // STORM STUN text
    const stormStunText = this.add.text(playerX, playerY - 80, '⚡ STORM STUN! ⚡', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#00ffff',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30);

    this.tweens.add({
      targets: stormStunText,
      scale: 1.5,
      alpha: 0,
      y: stormStunText.y - 50,
      duration: 2000,
      ease: 'Power2.easeOut',
      onComplete: () => stormStunText.destroy()
    });
  }

  private launchHungryStun() {
    console.log('🐍💥 HUNGRY STUN - Huge Serpent Devours ALL enemies!');
    
    const playerX = this.player.x;
    const playerY = this.player.y;
    const playerDirection = this.player.flipX ? -1 : 1;

    // Create huge serpent texture if it doesn't exist
    if (!this.textures.exists('huge_serpent')) {
      const g = this.add.graphics();
      // Draw huge serpent body (scaled up snake)
      // Head
      g.fillStyle(0x2d5016, 1); // Dark green
      g.fillEllipse(0, 0, 120, 80);
      // Eyes
      g.fillStyle(0xff0000, 1); // Red eyes
      g.fillCircle(-30, -10, 8);
      g.fillCircle(30, -10, 8);
      // Body segments
      g.fillStyle(0x4a7c2a, 1); // Medium green
      g.fillEllipse(0, 40, 100, 60);
      g.fillEllipse(0, 80, 90, 50);
      g.fillEllipse(0, 120, 80, 45);
      // Scales pattern
      g.fillStyle(0x3d6b1f, 0.8);
      for (let i = 0; i < 3; i++) {
        g.fillEllipse(-20 + i * 20, 40 + i * 20, 15, 10);
      }
      g.generateTexture('huge_serpent', 150, 200);
      g.destroy();
    }

    // Create serpent body segments with physics for contact detection
    const serpentSegments: Phaser.Physics.Arcade.Sprite[] = [];
    const segmentCount = 10; // More segments for longer serpent
    const segmentSpacing = 80;

    // Starting position behind player
    const startX = playerX - (playerDirection * 100);
    const startY = playerY + 200; // Start below/behind player

    // Create all segments with physics
    for (let i = 0; i < segmentCount; i++) {
      const segment = this.physics.add.sprite(startX, startY + (i * segmentSpacing), 'huge_serpent')
        .setDepth(15)
        .setScale(1.5 + (i * 0.1)) // Head is bigger
        .setAlpha(0)
        .setFlipX(playerDirection < 0);
      
      // Set up physics body for collision detection
      const body = segment.body as Phaser.Physics.Arcade.Body;
      body.setSize(120, 80);
      body.setAllowGravity(false);
      body.setImmovable(true);
      
      // Add overlap detection for enemies
      this.physics.add.overlap(segment, this.enemies.map(e => e.sprite), (_serpentSegment, enemySprite) => {
        const enemy = this.enemies.find(e => e.sprite === enemySprite);
        if (enemy && !enemy.isDead) {
          // Create devour effect
          const devourEffect = this.add.circle(enemy.sprite.x, enemy.sprite.y, 30, 0x2d5016, 0.8)
            .setDepth(enemy.sprite.depth + 1);
          
          this.tweens.add({
            targets: devourEffect,
            scale: 0,
            alpha: 0,
            duration: 300,
            ease: 'Power2.easeIn',
            onComplete: () => devourEffect.destroy()
          });

          // Kill enemy immediately (devoured)
          this.killEnemy(enemy);
        }
      }, undefined, this);

      // Add overlap detection for demons
      if (this.demons && this.demons.length > 0) {
        this.physics.add.overlap(segment, this.demons.map(d => d.sprite), (_serpentSegment, demonSprite) => {
          const demon = this.demons.find(d => d.sprite === demonSprite);
          if (demon) {
            // Create devour effect
            const devourEffect = this.add.circle(demon.sprite.x, demon.sprite.y, 40, 0x2d5016, 0.8)
              .setDepth(demon.sprite.depth + 1);
            
            this.tweens.add({
              targets: devourEffect,
              scale: 0,
              alpha: 0,
              duration: 300,
              ease: 'Power2.easeIn',
              onComplete: () => devourEffect.destroy()
            });

            // Kill demon immediately (devoured)
            demon.health = 0;
            this.killDemon(demon);
          }
        }, undefined, this);
      }
      
      serpentSegments.push(segment);
    }

    // Screen darken effect
    const darkOverlay = this.add.rectangle(400, 300, 800, 600, 0x000000, 0.7)
      .setDepth(14)
      .setScrollFactor(0)
      .setAlpha(0);

    this.tweens.add({
      targets: darkOverlay,
      alpha: 0.7,
      duration: 500,
      ease: 'Power2.easeIn'
    });

    // HUNGRY STUN text
    const hungryStunText = this.add.text(playerX, playerY - 100, '🐍 HUNGRY STUN! 🐍', {
      fontFamily: 'monospace',
      fontSize: '36px',
      color: '#4a7c2a',
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(30)
      .setAlpha(0);

    this.tweens.add({
      targets: hungryStunText,
      alpha: 1,
      scale: 1.2,
      duration: 300,
      ease: 'Back.easeOut'
    });

    // Serpent rises from behind player
    this.time.delayedCall(300, () => {
      serpentSegments.forEach((segment, index) => {
        this.time.delayedCall(index * 50, () => {
          segment.setAlpha(1);
          this.tweens.add({
            targets: segment,
            y: playerY - 100 + (index * 30),
            x: playerX - (playerDirection * 50) + (index * 10 * playerDirection),
            duration: 800,
            ease: 'Power2.easeOut'
          });
        });
      });
    });

    // Serpent strikes forward with extended movement
    this.time.delayedCall(1500, () => {
      // Strike animation - serpent lunges forward with extended movement
      serpentSegments.forEach((segment, index) => {
        const delay = index * 30; // Staggered movement for wave effect
        const forwardDistance = playerDirection * 1200; // Extended movement (much further)
        
        this.time.delayedCall(delay, () => {
          this.tweens.add({
            targets: segment,
            x: segment.x + forwardDistance,
            y: segment.y - 50,
            scale: segment.scaleX * 1.2,
            duration: 1200, // Longer duration for extended movement
            ease: 'Power2.easeIn',
            onComplete: () => {
              // Return to position
              this.tweens.add({
                targets: segment,
                x: segment.x - (playerDirection * 400),
                y: segment.y + 30,
                scale: segment.scaleX / 1.2,
                duration: 500,
                ease: 'Power2.easeOut'
              });
            }
          });
        });
      });
    });

    // Serpent retreats and disappears (after extended movement)
    this.time.delayedCall(3500, () => {
      serpentSegments.forEach((segment, index) => {
        this.time.delayedCall(index * 30, () => {
          this.tweens.add({
            targets: segment,
            y: playerY + 300,
            x: segment.x - (playerDirection * 100),
            alpha: 0,
            scale: 0.5,
            duration: 600,
            ease: 'Power2.easeIn',
            onComplete: () => segment.destroy()
          });
        });
      });

      // Remove dark overlay
      this.tweens.add({
        targets: darkOverlay,
        alpha: 0,
        duration: 500,
        ease: 'Power2.easeOut',
        onComplete: () => darkOverlay.destroy()
      });

      // Remove text
      this.tweens.add({
        targets: hungryStunText,
        scale: 1.5,
        alpha: 0,
        y: hungryStunText.y - 50,
        duration: 1000,
        ease: 'Power2.easeOut',
        onComplete: () => hungryStunText.destroy()
      });
    });

    // Screen shake for powerful attack
    this.cameras.main.shake(1000, 0.02);
  }

  private castStorm() {
    console.log('⚡ STORM - Chain lightning!');
    this.combatCooldowns.storm = 5000; // 5 second cooldown

    // Find closest enemy within 450px
    let nearestEnemy: any = null;
    let nearestDistance = Infinity;

    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 450 && distance < nearestDistance) {
          nearestDistance = distance;
          nearestEnemy = enemy;
        }
      }
    });

    this.demons.forEach(demon => {
      const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
      if (distance <= 450 && distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = demon;
      }
    });

    if (nearestEnemy) {
      this.chainLightning(this.player.x, this.player.y, nearestEnemy, [], 0);
    } else {
      console.log('⚡ No enemies within range for Storm!');
    }
  }

  private chainLightning(startX: number, startY: number, targetEnemy: any, hitEnemies: any[], jumpCount: number) {
    if (!targetEnemy || targetEnemy.isDead || hitEnemies.includes(targetEnemy) || jumpCount >= 5) return;

    // Create jagged lightning bolt effect
    const lightning = this.add.graphics().setDepth(25);
    lightning.lineStyle(3, 0xffffff, 1);
    lightning.beginPath();
    
    // Create jagged line segments
    const segments = 8;
    const deltaX = (targetEnemy.sprite.x - startX) / segments;
    const deltaY = (targetEnemy.sprite.y - startY) / segments;
    
    lightning.moveTo(startX, startY);
    for (let i = 1; i <= segments; i++) {
      const x = startX + deltaX * i + (Math.random() - 0.5) * 20;
      const y = startY + deltaY * i + (Math.random() - 0.5) * 20;
      lightning.lineTo(x, y);
    }
    lightning.lineTo(targetEnemy.sprite.x, targetEnemy.sprite.y);
    lightning.strokePath();

    // Add yellow glow
    const glow = this.add.graphics().setDepth(24);
    glow.lineStyle(6, 0xffff00, 0.5);
    glow.beginPath();
    glow.moveTo(startX, startY);
    glow.lineTo(targetEnemy.sprite.x, targetEnemy.sprite.y);
    glow.strokePath();

    // Remove lightning after short time
    this.time.delayedCall(200, () => {
      lightning.destroy();
      glow.destroy();
    });

    // Electric shake effect on hit
    const originalX = targetEnemy.sprite.x;
    const originalY = targetEnemy.sprite.y;
    const shakeIntensity = 5;
    const shakeDuration = 150;
    
    this.time.addEvent({
      delay: 20,
      repeat: shakeDuration / 20,
      callback: () => {
        if (!targetEnemy.isDead) {
          targetEnemy.sprite.setPosition(
            originalX + (Math.random() - 0.5) * shakeIntensity,
            originalY + (Math.random() - 0.5) * shakeIntensity
          );
        }
      }
    });

    // Restore position after shake
    this.time.delayedCall(shakeDuration, () => {
      if (!targetEnemy.isDead) {
        targetEnemy.sprite.setPosition(originalX, originalY);
      }
    });

    // Heavy damage (enough to kill most enemies)
    if ('hp' in targetEnemy) {
      this.damageEnemy(targetEnemy, 999); // Massive damage
    } else if ('health' in targetEnemy) {
      // For demons, reduce health to 0
      targetEnemy.health = 0;
      targetEnemy.sprite.setTint(0x444444);
      targetEnemy.sprite.setAlpha(0.5);
    }
    
    hitEnemies.push(targetEnemy);

    // Find next enemy to chain to within 250px
    let nextEnemy: any = null;
    let nextDistance = Infinity;

    this.enemies.forEach(enemy => {
      if (!enemy.isDead && !hitEnemies.includes(enemy)) {
        const distance = Phaser.Math.Distance.Between(targetEnemy.sprite.x, targetEnemy.sprite.y, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 250 && distance < nextDistance) {
          nextDistance = distance;
          nextEnemy = enemy;
        }
      }
    });

    this.demons.forEach(demon => {
      if (!hitEnemies.includes(demon)) {
        const distance = Phaser.Math.Distance.Between(targetEnemy.sprite.x, targetEnemy.sprite.y, demon.sprite.x, demon.sprite.y);
        if (distance <= 250 && distance < nextDistance) {
          nextDistance = distance;
          nextEnemy = demon;
        }
      }
    });

    // Chain to next enemy (up to 5 total jumps)
    if (nextEnemy && jumpCount < 4) {
      this.time.delayedCall(300, () => {
        this.chainLightning(targetEnemy.sprite.x, targetEnemy.sprite.y, nextEnemy, hitEnemies, jumpCount + 1);
      });
    }
  }

  private castBlind() {
    console.log('💫 BLIND - Flash stun!');
    this.combatCooldowns.blind = 4000; // 4 second cooldown

    // White flash effect around player
    const flash = this.add.circle(this.player.x, this.player.y, 300, 0xffffff, 0.9)
      .setDepth(30);

    this.tweens.add({
      targets: flash,
      scale: 1.2,
      alpha: 0,
      duration: 200,
      ease: 'Power2.easeOut',
      onComplete: () => flash.destroy()
    });

    // Screen flash effect
    const screenFlash = this.add.rectangle(400, 300, 800, 600, 0xffffff, 0.6)
      .setDepth(30)
      .setScrollFactor(0);

    this.tweens.add({
      targets: screenFlash,
      alpha: 0,
      duration: 150,
      ease: 'Power2.easeOut',
      onComplete: () => screenFlash.destroy()
    });

    // Stun enemies within 300px
    this.enemies.forEach(enemy => {
      if (!enemy.isDead && !enemy.sprite.getData('isStunned')) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
        if (distance <= 300) {
          // Store original properties
          const originalSpeed = enemy.speed || 1;
          
          // Apply stun
          enemy.sprite.setData('isStunned', true);
          enemy.sprite.setData('originalSpeed', originalSpeed);
          
          // Stop movement
          enemy.speed = 0;
          
          // Tint white
          enemy.sprite.setTint(0xffffff);

          // Remove stun after 5 seconds
          this.time.delayedCall(5000, () => {
            if (!enemy.isDead && enemy.sprite.getData('isStunned')) {
              enemy.sprite.setData('isStunned', false);
              enemy.sprite.clearTint();
              
              // Restore original properties
              enemy.speed = enemy.sprite.getData('originalSpeed');
            }
          });
        }
      }
    });

    // Stun demons within 300px
    this.demons.forEach(demon => {
      if (!demon.sprite.getData('isStunned')) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
        if (distance <= 300) {
          // Store original properties
          const originalSpeed = demon.chaseSpeed || 1;
          const originalAttackCooldown = demon.attackCooldown || 0;
          
          // Apply stun
          demon.sprite.setData('isStunned', true);
          demon.sprite.setData('originalSpeed', originalSpeed);
          demon.sprite.setData('originalAttackCooldown', originalAttackCooldown);
          
          // Stop movement and attacks
          demon.chaseSpeed = 0;
          demon.attackCooldown = 999999;
          
          // Tint white
          demon.sprite.setTint(0xffffff);

          // Remove stun after 5 seconds
          this.time.delayedCall(5000, () => {
            if (demon.sprite.getData('isStunned')) {
              demon.sprite.setData('isStunned', false);
              demon.sprite.clearTint();
              
              // Restore original properties
              demon.chaseSpeed = demon.sprite.getData('originalSpeed');
              demon.attackCooldown = demon.sprite.getData('originalAttackCooldown');
            }
          });
        }
      }
    });
  }

  private castHungry() {
    console.log('🐍 HUNGRY - Snake Attack!');
    
    // Create simple snake sprite
    if (!this.textures.exists('snake')) {
      const g = this.add.graphics();
      // Simple green rectangle for snake
      g.fillStyle(0x00ff00, 1);
      g.fillRect(0, 0, 40, 8);
      g.generateTexture('snake', 40, 8);
      g.destroy();
    }

    // Spawn snake at player position
    const snake = this.physics.add.sprite(this.player.x, this.player.y, 'snake')
      .setDepth(10);

    // Set snake velocity based on player facing direction
    const snakeBody = snake.body as Phaser.Physics.Arcade.Body;
    snakeBody.setAllowGravity(false);
    
    // Determine direction player is facing
    const direction = this.player.flipX ? -1 : 1;
    snakeBody.setVelocityX(direction * 900);

    // Add overlap with enemies - destroy enemy on contact
    this.physics.add.overlap(snake, this.enemies.map(e => e.sprite), (_snakeObj, enemySprite) => {
      // Find and destroy the enemy
      const enemy = this.enemies.find(e => e.sprite === enemySprite);
      if (enemy && !enemy.isDead) {
        this.killEnemy(enemy, 'HUNGRY');
        console.log('🐍 Snake destroyed enemy!');
      }
    });

    // Add overlap with demons - destroy demon on contact  
    if (this.demons && this.demons.length > 0) {
      this.physics.add.overlap(snake, this.demons.map(d => d.sprite), (_snakeObj, demonSprite) => {
        // Find and destroy the demon
        const demon = this.demons.find(d => d.sprite === demonSprite);
        if (demon) {
          demon.health = 0;
          demon.sprite.setTint(0x444444);
          demon.sprite.setAlpha(0.5);
          console.log('🐍 Snake destroyed demon!');
        }
      });
    }

    // Destroy snake after 4 seconds
    this.time.delayedCall(4000, () => {
      if (snake && snake.active) {
        snake.destroy();
        console.log('🐍 Snake disappeared after 4 seconds');
      }
    });
  }

  // ===========================
  // ENEMY SYSTEM
  // ===========================

  private isInsideAnyHookZone(x: number): boolean {
    return this.hookZoneDefinitions.some((zone) => x >= zone.start && x <= zone.end);
  }

  private getHookZoneContainingX(x: number): { start: number; end: number } | undefined {
    return this.hookZoneDefinitions.find((zone) => x >= zone.start && x <= zone.end);
  }

  private isPathCrossingHookZone(startX: number, endX: number): boolean {
    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    return this.hookZoneDefinitions.some((zone) => maxX >= zone.start && minX <= zone.end);
  }

  private enforceEnemyHookZoneBoundary(enemy: any): boolean {
    const zone = this.getHookZoneContainingX(enemy.sprite.x);
    if (!zone) return false;

    const distToStart = Math.abs(enemy.sprite.x - zone.start);
    const distToEnd = Math.abs(zone.end - enemy.sprite.x);
    if (distToStart < distToEnd) {
      enemy.sprite.x = zone.start - 12;
      enemy.body.setVelocityX(-Math.abs(enemy.speed || 50));
    } else {
      enemy.sprite.x = zone.end + 12;
      enemy.body.setVelocityX(Math.abs(enemy.speed || 50));
    }
    return true;
  }

  private ensureSpellGatedEnemySpawns() {
    if (!this.playerHasBlazeSpell && this.completedSpellWords.includes('BLAZE')) {
      this.playerHasBlazeSpell = true;
    }
    if (!this.playerHasFrostSpell && this.completedSpellWords.includes('FROST')) {
      this.playerHasFrostSpell = true;
    }

    if (this.playerHasBlazeSpell && !this.snowDemonsSpawned) {
      this.spawnSnowDemonsAfterBlazeUnlock();
    }
    if (this.playerHasFrostSpell && !this.fireDemonsSpawned) {
      this.spawnFireDemonsAfterFrostUnlock();
    }
  }

  private spawnEnemies() {
    // Basic red cube enemies are intentionally disabled.
    // Red demons are handled by buildDemons(), and spell-gated snow demons spawn after BLAZE unlock.
  }

  private getEnemySurfaceSpawnY(x: number, preferredY: number, spriteHeight: number): number {
    const desiredFeetY = preferredY + spriteHeight / 2;
    let chosenTopY: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    this.physics.world.staticBodies.entries.forEach((entry) => {
      const staticBody = entry as Phaser.Physics.Arcade.StaticBody;
      const gameObject = staticBody.gameObject as any;
      if (!gameObject || !gameObject.getData || !gameObject.getData('isPlatform')) return;

      const left = staticBody.x;
      const right = staticBody.x + staticBody.width;
      if (x < left - 8 || x > right + 8) return;

      const topY = staticBody.y;
      const distance = Math.abs(topY - desiredFeetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        chosenTopY = topY;
      }
    });

    const groundTopY = (this.map.heightInPixels - 16) - 20;
    const topY = chosenTopY ?? groundTopY;
    return topY - spriteHeight / 2;
  }

  private setupEnemyPlatformCollision(enemySprite: Phaser.GameObjects.Image) {
    this.physics.world.staticBodies.entries.forEach((entry) => {
      const staticBody = entry as Phaser.Physics.Arcade.StaticBody;
      const gameObject = staticBody.gameObject as any;
      if (gameObject && gameObject.getData && gameObject.getData('isPlatform')) {
        this.physics.add.collider(enemySprite, gameObject);
      }
    });
  }

  private spawnSnowDemonsAfterBlazeUnlock() {
    if (this.snowDemonsSpawned) return;

    const bandY = this.spawnPoint.y;
    const snowDemonSpawns = [
      { x: 1700, y: bandY - 100, patrolWidth: 140 },
      { x: 4300, y: bandY - 100, patrolWidth: 140 },
      { x: 7700, y: bandY - 100, patrolWidth: 160 },
    ];

    snowDemonSpawns.forEach((spawn) => {
      if (!this.isInsideAnyHookZone(spawn.x)) {
        this.createEnemy(spawn.x, spawn.y, spawn.patrolWidth, 'snow');
      }
    });

    this.snowDemonsSpawned = true;
    console.log('❄️ Snow Demons unlocked and spawned.');
  }

  private spawnFireDemonsAfterFrostUnlock() {
    if (this.fireDemonsSpawned) return;

    const bandY = this.spawnPoint.y;
    // Spawn only after the FROST hook-zone section of the level.
    const fireDemonSpawns = [
      { x: 4300, y: bandY - 100, patrolWidth: 140 },
      { x: 5700, y: bandY - 100, patrolWidth: 150 },
      { x: 7600, y: bandY - 100, patrolWidth: 170 },
    ];

    fireDemonSpawns.forEach((spawn) => {
      if (!this.isInsideAnyHookZone(spawn.x)) {
        this.createEnemy(spawn.x, spawn.y, spawn.patrolWidth, 'fire');
      }
    });

    this.fireDemonsSpawned = true;
    console.log('🔥 Fire Demons unlocked and spawned.');
  }

  private createEnemy(
    x: number,
    y: number,
    patrolWidth: number,
    enemyType: 'basic' | 'snow' | 'fire' = 'basic'
  ) {
    if (this.isInsideAnyHookZone(x)) return;

    // Create basic enemy texture if it doesn't exist
    if (enemyType === 'basic' && !this.textures.exists('enemy')) {
      const g = this.add.graphics();
      g.fillStyle(0xff4444, 1);
      g.fillRect(0, 0, 20, 20);
      g.generateTexture('enemy', 20, 20);
      g.destroy();
    }

    // Create snow demon texture if it doesn't exist
    if (enemyType === 'snow' && !this.textures.exists('snow_demon')) {
      const g = this.add.graphics();
      g.fillStyle(0x2563eb, 1);
      g.fillRect(2, 8, 20, 14);
      g.fillStyle(0x1d4ed8, 1);
      g.fillRect(4, 2, 16, 10);
      g.fillStyle(0x93c5fd, 1);
      g.fillRect(5, 3, 2, 2);
      g.fillRect(17, 3, 2, 2);
      g.fillStyle(0xffffff, 1);
      g.fillRect(8, 6, 8, 2);
      g.fillStyle(0x0f172a, 1);
      g.fillRect(7, 5, 2, 2);
      g.fillRect(15, 5, 2, 2);
      g.fillStyle(0x60a5fa, 1);
      g.fillRect(0, 10, 2, 8);
      g.fillRect(22, 10, 2, 8);
      g.generateTexture('snow_demon', 24, 24);
      g.destroy();
    }

    if (enemyType === 'fire' && !this.textures.exists('fire_demon')) {
      const g = this.add.graphics();
      g.fillStyle(0xf97316, 1);
      g.fillRect(2, 8, 20, 14);
      g.fillStyle(0xea580c, 1);
      g.fillRect(4, 2, 16, 10);
      g.fillStyle(0xfbbf24, 1);
      g.fillRect(5, 3, 2, 2);
      g.fillRect(17, 3, 2, 2);
      g.fillStyle(0x7c2d12, 1);
      g.fillRect(7, 5, 2, 2);
      g.fillRect(15, 5, 2, 2);
      g.fillStyle(0xdc2626, 1);
      g.fillRect(0, 10, 2, 8);
      g.fillRect(22, 10, 2, 8);
      g.generateTexture('fire_demon', 24, 24);
      g.destroy();
    }

    const textureKey =
      enemyType === 'snow'
        ? 'snow_demon'
        : enemyType === 'fire'
          ? 'fire_demon'
          : 'enemy';
    const enemy = this.add.image(x, y, textureKey)
      .setDepth(5);

    this.physics.add.existing(enemy);
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(true);
    body.setCollideWorldBounds(true);
    body.setBounce(0);
    const surfaceSpawnY = this.getEnemySurfaceSpawnY(x, y, enemy.displayHeight || 24);
    enemy.setY(surfaceSpawnY);
    body.updateFromGameObject();
    body.setVelocityX(enemyType === 'snow' ? 60 : enemyType === 'fire' ? 55 : 50);

    const fireBeam = enemyType === 'fire'
      ? this.add.graphics().setDepth(7)
      : undefined;

    const enemyData: (typeof this.enemies)[number] = {
      sprite: enemy,
      body: body,
      hp: enemyType === 'snow' ? 4 : enemyType === 'fire' ? 3 : 3,
      maxHp: enemyType === 'snow' ? 4 : enemyType === 'fire' ? 3 : 3,
      patrolMin: x - patrolWidth / 2,
      patrolMax: x + patrolWidth / 2,
      speed: enemyType === 'snow' ? 70 : enemyType === 'fire' ? 60 : 50,
      isDead: false,
      enemyType,
      snowballCooldown: enemyType === 'snow' ? 1000 : 0,
      canBeDamagedBy:
        enemyType === 'snow'
          ? ['BLAZE_SPEECH']
          : enemyType === 'fire'
            ? ['FROST_THEN_SWORD']
            : undefined,
      fireState: enemyType === 'fire' ? 'ACTIVE' : undefined,
      fireBeam,
      fireBeamTargetX: enemyType === 'fire' ? enemy.x : undefined,
      fireBeamTargetY: enemyType === 'fire' ? enemy.y : undefined,
      fireBeamTickCooldown: 0,
      frozenUntil: undefined,
    };

    this.enemies.push(enemyData);
    this.setupEnemyPlatformCollision(enemy);

    // Add collision with tilemap layers
    if (this.map && this.map.layers) {
      this.map.layers.forEach(layer => {
        if (layer.tilemapLayer) {
          this.physics.add.collider(enemy, layer.tilemapLayer);
        }
      });
    }
  }

  private throwSnowball(enemy: any, direction: number) {
    if (this.isInsideAnyHookZone(enemy.sprite.x)) return;

    if (!this.textures.exists('snowball')) {
      const g = this.add.graphics();
      g.fillStyle(0x93c5fd, 1);
      g.fillCircle(6, 6, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 2);
      g.generateTexture('snowball', 12, 12);
      g.destroy();
    }

    const snowball = this.physics.add.image(
      enemy.sprite.x + direction * 16,
      enemy.sprite.y - 6,
      'snowball'
    ).setDepth(8);

    const snowballBody = snowball.body as Phaser.Physics.Arcade.Body;
    snowballBody.setAllowGravity(false);
    snowballBody.setVelocityX(direction * 240);

    this.snowballs.push(snowball);

    this.physics.add.overlap(this.player, snowball, () => {
      if (!snowball.active) return;
      this.applyPlayerSnowSlow();
      const idx = this.snowballs.indexOf(snowball);
      if (idx > -1) {
        this.snowballs.splice(idx, 1);
      }
      snowball.destroy();
    }, undefined, this);

    this.time.delayedCall(3000, () => {
      const idx = this.snowballs.indexOf(snowball);
      if (idx > -1) {
        this.snowballs.splice(idx, 1);
      }
      if (snowball.active) {
        snowball.destroy();
      }
    });
  }

  private updateSnowballs() {
    for (let i = this.snowballs.length - 1; i >= 0; i--) {
      const snowball = this.snowballs[i];
      if (!snowball || !snowball.active) {
        this.snowballs.splice(i, 1);
        continue;
      }

      if (this.isInsideAnyHookZone(snowball.x)) {
        snowball.destroy();
        this.snowballs.splice(i, 1);
        continue;
      }

      if (snowball.x < -400 || snowball.x > this.map.widthInPixels + 9000) {
        snowball.destroy();
        this.snowballs.splice(i, 1);
      }
    }
  }

  private applyPlayerSnowSlow() {
    this.playerSlowMovementMultiplier = 0.55;

    if (this.playerSlowTimer) {
      this.playerSlowTimer.remove();
      this.playerSlowTimer = undefined;
    }

    this.playerSlowTimer = this.time.delayedCall(1800, () => {
      this.playerSlowMovementMultiplier = 1;
      this.playerSlowTimer = undefined;
    });
  }

  private freezeFireDemon(enemy: any, durationMs: number) {
    if (!enemy || enemy.isDead || enemy.enemyType !== 'fire') return;

    enemy.fireState = 'FROZEN';
    enemy.frozenUntil = this.time.now + durationMs;
    enemy.speed = 0;
    enemy.body.setVelocityX(0);
    enemy.sprite.setData('isFrozen', true);
    enemy.sprite.setTint(0x93c5fd);
    this.clearFireBeam(enemy);
  }

  private clearFireBeam(enemy: any) {
    if (enemy?.fireBeam && enemy.fireBeam.active) {
      enemy.fireBeam.clear();
    }
  }

  private distancePointToSegment(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    if (dx === 0 && dy === 0) return Phaser.Math.Distance.Between(px, py, x1, y1);

    const t = Phaser.Math.Clamp(
      ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy),
      0,
      1
    );
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Phaser.Math.Distance.Between(px, py, projX, projY);
  }

  private applyFireBeamDamageTick() {
    if (this.isInvulnerable) return;

    // Beam damage accumulates in milliseconds-equivalent chunks (tick is ~250ms).
    this.fireBeamBurnMeter += 250;
    if (this.fireBeamBurnDecayTimer) {
      this.fireBeamBurnDecayTimer.remove();
      this.fireBeamBurnDecayTimer = undefined;
    }

    // Require near-continuous contact: brief beam breaks reset buildup.
    this.fireBeamBurnDecayTimer = this.time.delayedCall(500, () => {
      this.fireBeamBurnMeter = 0;
      this.fireBeamBurnDecayTimer = undefined;
    });

    // Kill after ~4 seconds of sustained beam contact.
    if (this.fireBeamBurnMeter >= 4000) {
      this.fireBeamBurnMeter = 0;
      this.handlePlayerDeath();
    }
  }

  private updateFireDemonAI(enemy: any, playerInHookZone: boolean) {
    const { sprite, body } = enemy;
    if (!sprite.active) return;

    if (enemy.fireState === 'FROZEN') {
      body.setVelocityX(0);
      this.clearFireBeam(enemy);
      if (enemy.frozenUntil !== undefined && this.time.now >= enemy.frozenUntil) {
        enemy.fireState = 'ACTIVE';
        enemy.frozenUntil = undefined;
        enemy.sprite.setData('isFrozen', false);
        enemy.sprite.clearTint();
        enemy.speed = 60;
      }
      return;
    }

    const distanceToPlayer = Phaser.Math.Distance.Between(
      sprite.x,
      sprite.y,
      this.player.x,
      this.player.y
    );

    const shouldChase = distanceToPlayer < 650 && !playerInHookZone;
    if (shouldChase) {
      const direction = this.player.x > sprite.x ? 1 : -1;
      body.setVelocityX(direction * enemy.speed);
      sprite.setFlipX(direction < 0);
    } else {
      if (sprite.x <= enemy.patrolMin && body.velocity.x < 0) {
        body.setVelocityX(enemy.speed * 0.8);
      } else if (sprite.x >= enemy.patrolMax && body.velocity.x > 0) {
        body.setVelocityX(-enemy.speed * 0.8);
      }
    }

    for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
      const zone = this.hookZoneDefinitions[i];
      if (sprite.x < zone.start && sprite.x > zone.start - 20 && body.velocity.x > 0) {
        body.setVelocityX(0);
        sprite.x = zone.start - 12;
      } else if (sprite.x > zone.end && sprite.x < zone.end + 20 && body.velocity.x < 0) {
        body.setVelocityX(0);
        sprite.x = zone.end + 12;
      }
    }

    const canBeamPlayer =
      !playerInHookZone &&
      distanceToPlayer < 520 &&
      !this.isPathCrossingHookZone(sprite.x, this.player.x);

    if (!canBeamPlayer) {
      this.clearFireBeam(enemy);
      return;
    }

    enemy.fireBeamTargetX = Phaser.Math.Linear(
      enemy.fireBeamTargetX ?? this.player.x,
      this.player.x,
      0.08
    );
    enemy.fireBeamTargetY = Phaser.Math.Linear(
      enemy.fireBeamTargetY ?? this.player.y,
      this.player.y,
      0.08
    );

    if (enemy.fireBeam && enemy.fireBeam.active) {
      const beamStartX = sprite.x;
      const beamStartY = sprite.y - 6;
      const beamEndX = enemy.fireBeamTargetX;
      const beamEndY = enemy.fireBeamTargetY;

      enemy.fireBeam.clear();
      enemy.fireBeam.lineStyle(7, 0xff4500, 0.75);
      enemy.fireBeam.beginPath();
      enemy.fireBeam.moveTo(beamStartX, beamStartY);
      enemy.fireBeam.lineTo(beamEndX, beamEndY);
      enemy.fireBeam.strokePath();

      enemy.fireBeam.lineStyle(3, 0xfff07a, 0.9);
      enemy.fireBeam.beginPath();
      enemy.fireBeam.moveTo(beamStartX, beamStartY);
      enemy.fireBeam.lineTo(beamEndX, beamEndY);
      enemy.fireBeam.strokePath();

      const playerDistanceToBeam = this.distancePointToSegment(
        this.player.x,
        this.player.y,
        beamStartX,
        beamStartY,
        beamEndX,
        beamEndY
      );
      enemy.fireBeamTickCooldown = Math.max(0, (enemy.fireBeamTickCooldown ?? 0) - 16);
      if (playerDistanceToBeam <= 20 && enemy.fireBeamTickCooldown <= 0) {
        this.applyFireBeamDamageTick();
        enemy.fireBeamTickCooldown = 250;
      }
    }
  }

  private canEnemyBeDefeatedBy(enemy: any, source: string): boolean {
    if (!enemy) return true;

    if (enemy.enemyType === 'snow') {
      return source === 'BLAZE_SPEECH';
    }

    if (enemy.enemyType === 'fire') {
      if (source === 'SWORD') {
        return enemy.fireState === 'FROZEN';
      }
      return false;
    }

    return true;
  }

  private destroySnowDemonsFromSpeechBlaze() {
    this.enemies
      .filter((enemy) => !enemy.isDead && enemy.enemyType === 'snow')
      .forEach((enemy) => this.killEnemy(enemy, 'BLAZE_SPEECH'));
  }

  private updateSnowDemonAI(enemy: any, playerInHookZone: boolean) {
    const { sprite, body } = enemy;

    const isHardStopped = sprite.getData('isFrozen') || sprite.getData('isStunned') || sprite.getData('isParalyzed');
    if (isHardStopped) {
      enemy.snowballCooldown = Math.max(0, enemy.snowballCooldown - 16);
      return;
    }

    const distanceToPlayer = Phaser.Math.Distance.Between(
      sprite.x,
      sprite.y,
      this.player.x,
      this.player.y
    );
    const shouldChase = distanceToPlayer < 600 && !playerInHookZone;

    if (shouldChase) {
      const direction = this.player.x > sprite.x ? 1 : -1;
      body.setVelocityX(direction * enemy.speed);
      sprite.setFlipX(direction < 0);

      const canThrowAtPlayer =
        distanceToPlayer < 500 &&
        !this.isInsideAnyHookZone(this.player.x) &&
        !this.isPathCrossingHookZone(sprite.x, this.player.x);

      if (enemy.snowballCooldown <= 0 && canThrowAtPlayer) {
        this.throwSnowball(enemy, direction);
        enemy.snowballCooldown = 1700;
      }
    } else {
      // Default to patrol when not actively chasing
      if (sprite.x <= enemy.patrolMin && body.velocity.x < 0) {
        body.setVelocityX(enemy.speed * 0.8);
      } else if (sprite.x >= enemy.patrolMax && body.velocity.x > 0) {
        body.setVelocityX(-enemy.speed * 0.8);
      }
    }

    enemy.snowballCooldown = Math.max(0, enemy.snowballCooldown - 16);

    for (let i = 0; i < this.hookZoneDefinitions.length; i++) {
      const zone = this.hookZoneDefinitions[i];
      if (sprite.x < zone.start && sprite.x > zone.start - 20 && body.velocity.x > 0) {
        body.setVelocityX(0);
        sprite.x = zone.start - 12;
      } else if (sprite.x > zone.end && sprite.x < zone.end + 20 && body.velocity.x < 0) {
        body.setVelocityX(0);
        sprite.x = zone.end + 12;
      }
    }
  }

  private updateEnemyAI() {
    const playerInHookZone = this.isInsideAnyHookZone(this.player.x);

    this.enemies.forEach(enemy => {
      if (enemy.isDead) return;

      if (this.enforceEnemyHookZoneBoundary(enemy)) {
        return;
      }

      if (enemy.enemyType === 'fire') {
        this.updateFireDemonAI(enemy, playerInHookZone);
        return;
      }

      if (enemy.enemyType === 'snow') {
        this.updateSnowDemonAI(enemy, playerInHookZone);
        return;
      }

      // Basic patrol behavior
      if (enemy.sprite.x <= enemy.patrolMin && enemy.body.velocity.x < 0) {
        enemy.body.setVelocityX(enemy.speed);
      } else if (enemy.sprite.x >= enemy.patrolMax && enemy.body.velocity.x > 0) {
        enemy.body.setVelocityX(-enemy.speed);
      }

      const projectedX = enemy.sprite.x + enemy.body.velocity.x * 0.1;
      if (this.isPathCrossingHookZone(enemy.sprite.x, projectedX)) {
        enemy.body.setVelocityX(-enemy.body.velocity.x);
      }
    });
  }

  private updateProjectiles() {
    this.projectiles.forEach((projectile, index) => {
      // Check projectile vs enemy collision
      this.enemies.forEach(enemy => {
        if (!enemy.isDead) {
          const distance = Phaser.Math.Distance.Between(projectile.x, projectile.y, enemy.sprite.x, enemy.sprite.y);
          if (distance < 25) {
            this.damageEnemy(enemy, 1);
            // Remove projectile
            this.projectiles.splice(index, 1);
            projectile.destroy();
          }
        }
      });
    });
  }

  private damageEnemy(enemy: any, damage: number, source: string = 'GENERIC') {
    if (!enemy || enemy.isDead) return;

    if (!this.canEnemyBeDefeatedBy(enemy, source)) {
      enemy.sprite.setTint(0x93c5fd);
      this.time.delayedCall(100, () => {
        if (!enemy.isDead) {
          enemy.sprite.clearTint();
        }
      });
      return;
    }

    enemy.hp -= damage;
    
    // Flash red
    enemy.sprite.setTint(0xff0000);
    this.time.delayedCall(100, () => {
      if (!enemy.isDead) {
        enemy.sprite.clearTint();
      }
    });

    console.log(`Enemy hit for ${damage} damage! HP: ${enemy.hp}/${enemy.maxHp}`);

    if (enemy.hp <= 0) {
      this.killEnemy(enemy, source);
    }
  }

  private killEnemy(enemy: any, source: string = 'GENERIC') {
    if (!enemy || enemy.isDead) return;
    if (!this.canEnemyBeDefeatedBy(enemy, source)) return;

    enemy.isDead = true;
    enemy.fireState = 'DEAD';
    enemy.frozenUntil = undefined;
    if (enemy.fireBeam && enemy.fireBeam.active) {
      enemy.fireBeam.destroy();
      enemy.fireBeam = undefined;
    }
    
    // Remove ice block if enemy was frozen
    if (enemy.sprite.getData('isFrozen')) {
      const iceBlock = enemy.sprite.getData('iceBlock');
      if (iceBlock && iceBlock.active) {
        iceBlock.destroy();
      }
    }
    
    // Remove fire effect if enemy was scorched
    if (enemy.sprite.getData('isScorched')) {
      const fireEffect = enemy.sprite.getData('fireEffect');
      if (fireEffect && fireEffect.active) {
        fireEffect.destroy();
      }
    }
    
    // Remove lightning bolt if enemy was paralyzed
    if (enemy.sprite.getData('isParalyzed')) {
      const lightningBolt = enemy.sprite.getData('lightningBolt');
      if (lightningBolt && lightningBolt.active) {
        lightningBolt.destroy();
      }
    }
    
    // Death particles
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const particleColor = enemy.enemyType === 'snow' ? 0x93c5fd : 0xff4444;
      const particle = this.add.rectangle(
        enemy.sprite.x + Math.cos(angle) * 15,
        enemy.sprite.y + Math.sin(angle) * 15,
        4, 4, particleColor
      ).setDepth(15);

      this.tweens.add({
        targets: particle,
        alpha: 0,
        scale: 0.2,
        duration: 300,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy()
      });
    }

    // Remove enemy
    enemy.sprite.destroy();
    const index = this.enemies.indexOf(enemy);
    if (index > -1) {
      this.enemies.splice(index, 1);
    }

    console.log('💀 Enemy defeated!');
  }

  private damageDemon(demon: any, damage: number) {
    if (!demon || demon.isStunned) return;
    
    demon.health -= damage;
    
    // Flash red
    demon.sprite.setTint(0xff0000);
    this.time.delayedCall(100, () => {
      if (demon.sprite && demon.sprite.active) {
        demon.sprite.clearTint();
      }
    });

    console.log(`⚔️ Demon hit for ${damage} damage! HP: ${demon.health}/200`);

    if (demon.health <= 0) {
      this.killDemon(demon);
    }
  }


  private handlePlayerDeath() {
    if (this.isInvulnerable) return;

    this.resetActiveHookZoneProgressOnDeath();

    this.fireBeamBurnMeter = 0;
    if (this.fireBeamBurnDecayTimer) {
      this.fireBeamBurnDecayTimer.remove();
      this.fireBeamBurnDecayTimer = undefined;
    }

    this.isInvulnerable = true;
    this.lives -= 1;
    console.log(`💔 Lives remaining: ${this.lives}`);

    // ===== CRITICAL: Reset hook zone state to prevent crashes =====
    // Stop all player tweens (traversal, suspension floating, etc.)
    this.tweens.killTweensOf(this.player);
    if (this.activeTraversalTween) {
      this.activeTraversalTween.stop();
      this.activeTraversalTween = undefined;
    }

    // Reset traversal and suspension state
    this.isTraversing = false;
    this.isSuspended = false;
    this.manualControlEnabled = true;

    // Clear suspension timer and effects
    if (this.suspensionTimer) {
      this.suspensionTimer.remove();
      this.suspensionTimer = undefined;
    }
    if (this.suspensionGlowEffect) {
      this.tweens.killTweensOf(this.suspensionGlowEffect);
      this.suspensionGlowEffect.destroy();
      this.suspensionGlowEffect = undefined;
    }

    // Clear suspension references
    this.currentSuspendedNode = undefined;
    this.suspensionLandingY = 0;
    // ===== END hook zone state reset =====

    // Flash effect
    this.player.setTint(0xff0000);
    this.time.delayedCall(100, () => {
      this.player.clearTint();
    });

    if (this.lives <= 0) {
      console.log('💀 Game Over!');
      this.scene.restart();
    } else {
      if (this.respawnOutsideHookZoneEntranceIfNeeded()) {
        // Hook-zone deaths are zone-local and do not use global checkpoints
      } else if (this.respawnAtCompletedHookZoneExitIfNeeded()) {
        // Death just after a solved hook zone respawns at that zone's exit
      } else if (this.checkpointReached && this.checkpointPosition) {
        // Respawn at established checkpoint
        this.player.setPosition(this.checkpointPosition.x, this.checkpointPosition.y);
        console.log(`🚩 Respawning at CHECKPOINT: (${this.checkpointPosition.x}, ${this.checkpointPosition.y})`);
      } else {
        // Only use spawn point if NO checkpoint has ever been established
        this.player.setPosition(this.spawnPoint.x, this.spawnPoint.y);
        console.log(`⚠️ No checkpoint established yet - respawning at spawn point: (${this.spawnPoint.x}, ${this.spawnPoint.y})`);
      }

      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
      body.enable = true;  // Ensure body is enabled
      body.setAllowGravity(true);  // Ensure gravity is enabled

      // Invulnerability period
      this.time.delayedCall(1000, () => {
        this.isInvulnerable = false;
      });
    }
  }

  private checkEnemyPlayerCollision() {
    if (this.isInvulnerable) return;

    // Check collision with regular enemies
    this.enemies.forEach(enemy => {
      if (!enemy.isDead) {
        const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, enemy.sprite.x, enemy.sprite.y);
        if (distance < 25) {
          this.handlePlayerDeath();
        }
      }
    });

    // Check collision with demons
    if (this.demons) {
      this.demons.forEach(demon => {
        if (!demon.isStunned) {
          const distance = Phaser.Math.Distance.Between(this.player.x, this.player.y, demon.sprite.x, demon.sprite.y);
          if (distance < 30) {
            this.handlePlayerDeath();
          }
        }
      });
    }
  }

  private activateCheckpointOnWordCompletion(wordCompleted: string) {
    console.log(`🚩 CHECKPOINT ACTIVATED! Word "${wordCompleted}" completed!`);
    console.log(`📍 Previous checkpoint: ${this.checkpointReached ? 'YES' : 'NONE'}`);
    
    // Set checkpoint position to player's current location
    this.checkpointPosition = new Phaser.Math.Vector2(this.player.x, this.player.y);
    this.checkpointReached = true;
    
    console.log(`📍 New checkpoint established at: (${this.player.x}, ${this.player.y})`);
    console.log(`🔒 All future deaths will respawn here until next word completion!`);

    // Create or move checkpoint flag
    if (this.checkpointFlag) {
      // Move existing flag
      this.checkpointFlag.setPosition(this.player.x, this.player.y - 40);
    } else {
      // Create new flag
      this.checkpointFlag = this.add.image(this.player.x, this.player.y - 40, 'checkpoint_flag')
        .setDepth(10)
        .setOrigin(0.5, 1);
    }

    // Flag animation
    this.tweens.add({
      targets: this.checkpointFlag,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 200,
      yoyo: true,
      ease: 'Power2.easeInOut'
    });

    // Checkpoint activation effect
    const checkpointEffect = this.add.circle(this.player.x, this.player.y, 50, 0x00ff00, 0.3)
      .setDepth(15);

    this.tweens.add({
      targets: checkpointEffect,
      scale: 2,
      alpha: 0,
      duration: 800,
      ease: 'Power2.easeOut',
      onComplete: () => checkpointEffect.destroy()
    });

    // Checkpoint text
    const checkpointText = this.add.text(this.player.x, this.player.y - 60, '🚩 CHECKPOINT!', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#00ff00',
      stroke: '#000000',
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);

    this.tweens.add({
      targets: checkpointText,
      y: checkpointText.y - 30,
      alpha: 0,
      duration: 1500,
      ease: 'Power2.easeOut',
      onComplete: () => checkpointText.destroy()
    });
  }

  // Method to be called when a word is completed
  private async onWordCompleted(word: string) {
    // Special handling for HUNGRY - requires pronunciation check
    if (word === 'HUNGRY') {
      await this.handleHungryWordCompletion();
      return;
    }

    // Add to completed spell words if not already there
    if (!this.completedSpellWords.includes(word)) {
      this.completedSpellWords.push(word);
      console.log(`✨ Word "${word}" completed! Available for spells.`);
      
      // Activate checkpoint when word is completed
      this.activateCheckpointOnWordCompletion(word);
    }
  }

  private async handleHungryWordCompletion() {
    console.log(`🎤 HUNGRY word traversal completed! Starting pronunciation check...`);
    
    // Show instruction to use V key for pronunciation
    const instructionText = this.add.text(
      this.player.x,
      this.player.y - 100,
      'HUNGRY traversal complete!\nPress V to unlock with pronunciation',
      {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#fbbf24',
        stroke: '#000000',
        strokeThickness: 2,
        align: 'center'
      }
    ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

    this.tweens.add({
      targets: instructionText,
      alpha: 0,
      y: instructionText.y - 40,
      duration: 4000,
      ease: 'Sine.easeOut',
      onComplete: () => instructionText.destroy(),
    });

    // Store that HUNGRY traversal is complete but not yet unlocked
    if (!this.completedWords.includes('HUNGRY')) {
      this.completedWords.push('HUNGRY');
    }
  }

  private async handleHungryPronunciationCheck() {
    if (this.isRecordingPronunciation) {
      console.log('🎤 Already recording pronunciation...');
      return;
    }

    try {
      console.log('🎤 Starting HUNGRY pronunciation check...');
      
      const pronunciationCorrect = await this.checkPronunciation('HUNGRY');
      
      if (pronunciationCorrect) {
        // Unlock HUNGRY ability
        this.hungryUnlocked = true;
        if (!this.completedSpellWords.includes('HUNGRY')) {
          this.completedSpellWords.push('HUNGRY');
          console.log(`✨ HUNGRY unlocked via pronunciation! Available for spells.`);
          
          // Activate checkpoint for HUNGRY
          this.activateCheckpointOnWordCompletion('HUNGRY');
        }
      } else {
        // Show retry message
        const retryText = this.add.text(
          this.player.x,
          this.player.y - 60,
          'Try again! Press V to retry pronunciation',
          {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#fbbf24',
            stroke: '#000000',
            strokeThickness: 2,
          }
        ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

        this.tweens.add({
          targets: retryText,
          alpha: 0,
          duration: 3000,
          ease: 'Sine.easeOut',
          onComplete: () => retryText.destroy(),
        });
      }
      
    } catch (error) {
      console.error('🎤 HUNGRY pronunciation check failed:', error);
      
      const errorText = this.add.text(
        this.player.x,
        this.player.y - 60,
        'Microphone error! Try again with V key',
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ef4444',
          stroke: '#000000',
          strokeThickness: 2,
        }
      ).setOrigin(0.5).setDepth(100).setScrollFactor(1);

      this.tweens.add({
        targets: errorText,
        alpha: 0,
        duration: 3000,
        ease: 'Sine.easeOut',
        onComplete: () => errorText.destroy(),
      });
    }
  }

  // TEST METHOD: Simulate word completion (for testing checkpoint system)
  private testWordCompletion() {
    const testWords = ['BLAZE', 'FROST', 'STORM', 'BLIND', 'HUNGRY'];
    const nextWord = testWords.find(word => !this.completedSpellWords.includes(word));
    
    if (nextWord) {
      console.log(`🧪 TEST: Simulating completion of word "${nextWord}"`);
      this.onWordCompleted(nextWord);
    } else {
      console.log(`🧪 TEST: All words already completed!`);
    }
  }

  private createCheckpointFlagTexture() {
    if (!this.textures.exists('checkpoint_flag')) {
      const g = this.add.graphics();
      
      // Flag pole (brown)
      g.fillStyle(0x8b4513, 1);
      g.fillRect(0, 0, 3, 30);
      
      // Flag (green)
      g.fillStyle(0x00ff00, 1);
      g.fillRect(3, 2, 20, 12);
      
      // Flag details (darker green)
      g.fillStyle(0x00cc00, 1);
      g.fillRect(5, 4, 16, 2);
      g.fillRect(5, 8, 16, 2);
      g.fillRect(5, 12, 16, 2);
      
      g.generateTexture('checkpoint_flag', 25, 30);
      g.destroy();
    }
  }

  private createMagicBoltTexture() {
    if (!this.textures.exists('magic_shuriken')) {
      const g = this.add.graphics();
      
      // Magic shuriken shape (4-pointed star)
      g.fillStyle(0x60a5fa, 1);
      
      // Draw 4-pointed shuriken
      const centerX = 12;
      const centerY = 12;
      const outerRadius = 10;
      const innerRadius = 4;
      
      // Create star points
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const radius = i % 2 === 0 ? outerRadius : innerRadius;
        const x = centerX + Math.cos(angle) * radius;
        const y = centerY + Math.sin(angle) * radius;
        
        if (i === 0) {
          g.moveTo(x, y);
        } else {
          g.lineTo(x, y);
        }
      }
      g.closePath();
      g.fillPath();
      
      // Inner glow
      g.fillStyle(0x93c5fd, 1);
      g.fillCircle(centerX, centerY, 3);
      
      // Core
      g.fillStyle(0xffffff, 1);
      g.fillCircle(centerX, centerY, 1);
      
      g.generateTexture('magic_shuriken', 24, 24);
      g.destroy();
    }
  }

  // ===========================
  // JUMUF COMPANION SYSTEM
  // ===========================

  private createStaticGenieNpc() {
    if (!this.textures.exists('genie_npc_static')) {
      const g = this.add.graphics();
      const px = 3;
      const p = (x: number, y: number, w: number, h: number, color: number) => {
        g.fillStyle(color, 1);
        g.fillRect(x * px, y * px, w * px, h * px);
      };

      // Lamp
      p(5, 17, 6, 2, 0xf59e0b);
      p(4, 18, 2, 1, 0xf59e0b);
      p(10, 18, 2, 1, 0xf59e0b);
      p(7, 19, 2, 1, 0xf59e0b);

      // Tail
      p(7, 12, 2, 5, 0x38bdf8);
      p(6, 14, 1, 2, 0x38bdf8);
      p(9, 13, 1, 2, 0x0ea5e9);

      // Body and arms
      p(4, 7, 8, 5, 0x22d3ee);
      p(3, 8, 1, 3, 0x38bdf8);
      p(12, 8, 1, 3, 0x38bdf8);
      p(4, 10, 8, 1, 0x0ea5e9);

      // Head/face
      p(5, 4, 6, 3, 0x38bdf8);
      p(6, 5, 1, 1, 0x1f2937);
      p(9, 5, 1, 1, 0x1f2937);

      // Turban
      p(5, 2, 6, 1, 0xf87171);
      p(5, 3, 3, 1, 0xef4444);
      p(9, 3, 2, 1, 0xf87171);

      // Gold accents
      p(4, 9, 1, 1, 0xf59e0b);
      p(11, 9, 1, 1, 0xf59e0b);
      p(6, 12, 4, 1, 0xf59e0b);

      g.generateTexture('genie_npc_static', 16 * px, 20 * px);
      g.destroy();
    }

    const groundY = this.map.heightInPixels - 16;
    this.staticGenieNpc = this.add.image(660, groundY - 18, 'genie_npc_static')
      .setOrigin(0.5, 1)
      .setDepth(6);
  }

  private createJumuf() {
    // Create Jumuf as a pixel-art genie companion (visual only; behavior unchanged)
    const graphics = this.add.graphics();
    const px = 3;
    const p = (x: number, y: number, w: number, h: number, color: number) => {
      graphics.fillStyle(color, 1);
      graphics.fillRect(x * px, y * px, w * px, h * px);
    };

    // Lamp
    p(5, 17, 6, 2, 0xf59e0b);
    p(4, 18, 2, 1, 0xf59e0b);
    p(10, 18, 2, 1, 0xf59e0b);
    p(7, 19, 2, 1, 0xf59e0b);

    // Tail
    p(7, 12, 2, 5, 0x38bdf8);
    p(6, 14, 1, 2, 0x38bdf8);
    p(9, 13, 1, 2, 0x0ea5e9);

    // Body and arms
    p(4, 7, 8, 5, 0x22d3ee);
    p(3, 8, 1, 3, 0x38bdf8);
    p(12, 8, 1, 3, 0x38bdf8);
    p(4, 10, 8, 1, 0x0ea5e9);

    // Head/face
    p(5, 4, 6, 3, 0x38bdf8);
    p(6, 5, 1, 1, 0x1f2937);
    p(9, 5, 1, 1, 0x1f2937);

    // Turban
    p(5, 2, 6, 1, 0xf87171);
    p(5, 3, 3, 1, 0xef4444);
    p(9, 3, 2, 1, 0xf87171);

    // Gold accents
    p(4, 9, 1, 1, 0xf59e0b);
    p(11, 9, 1, 1, 0xf59e0b);
    p(6, 12, 4, 1, 0xf59e0b);

    graphics.generateTexture('jumuf', 16 * px, 20 * px);
    graphics.destroy();

    // Create Jumuf sprite
    this.jumuf = this.add.image(this.player.x - 30, this.player.y - 40, 'jumuf')
      .setDepth(4) // Behind player (depth 5)
      .setAlpha(0) // Start invisible for entrance animation
      .setScale(0.8);

    // Create bobbing animation
    this.jumufBobbingTween = this.tweens.add({
      targets: this.jumuf,
      y: '-=10',
      duration: 1500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1
    });

    // Entrance animation - appear with a nice effect at the start
    this.time.delayedCall(300, () => {
      if (this.jumuf) {
        this.jumufVisible = true;
        this.jumuf.setAlpha(1);
        // Entrance animation - pop in with scale
        this.jumuf.setScale(0);
        this.tweens.add({
          targets: this.jumuf,
          scale: 0.8,
          duration: 600,
          ease: 'Back.easeOut'
        });
      }
    });

    // Disappear after initial appearance (3 seconds after appearing)
    this.time.delayedCall(3900, () => {
      if (this.jumuf && this.jumufVisible) {
        this.hideJumuf();
      }
    });

    // Disappear after initial appearance (3 seconds after appearing)
    this.time.delayedCall(3900, () => {
      if (this.jumuf && this.jumufVisible) {
        this.hideJumuf();
      }
    });
  }

  private updateJumufFollow() {
    if (!this.jumuf || !this.jumufVisible) return;

    // Smooth lerp following behind and above player
    const targetX = this.player.x - 30;
    const targetY = this.player.y - 40;
    
    // Lerp smoothing (0.1 = smooth, 0.3 = faster)
    this.jumuf.x = Phaser.Math.Linear(this.jumuf.x, targetX, 0.15);
    this.jumuf.y = Phaser.Math.Linear(this.jumuf.y, targetY, 0.15);
  }

  private showJumuf() {
    if (!this.jumuf) return;
    
    this.jumufVisible = true;
    this.tweens.add({
      targets: this.jumuf,
      alpha: 1,
      duration: 500,
      ease: 'Power2.easeOut'
    });
  }

  private hideJumuf() {
    if (!this.jumuf) return;
    
    this.jumufVisible = false;
    this.tweens.add({
      targets: this.jumuf,
      alpha: 0,
      duration: 500,
      ease: 'Power2.easeIn',
      onComplete: () => {
        if (this.jumufHintBubble) {
          this.jumufHintBubble.destroy();
          this.jumufHintBubble = undefined;
        }
      }
    });
  }

  private jumufGiveHint(text: string) {
    if (!this.jumuf) return;

    // Show Jumuf if not visible
    if (!this.jumufVisible) {
      this.showJumuf();
    }

    // Remove existing hint bubble if any
    if (this.jumufHintBubble) {
      this.jumufHintBubble.destroy();
    }

    // Create speech bubble container
    this.jumufHintBubble = this.add.container(this.jumuf.x, this.jumuf.y - 60);

    // Speech bubble background
    const bubbleBg = this.add.graphics();
    bubbleBg.fillStyle(0xffffff, 0.95);
    bubbleBg.fillRoundedRect(-80, -25, 160, 50, 10);
    bubbleBg.lineStyle(3, 0x8b5cf6, 1);
    bubbleBg.strokeRoundedRect(-80, -25, 160, 50, 10);
    
    // Speech bubble tail (pointing to Jumuf)
    bubbleBg.fillStyle(0xffffff, 0.95);
    bubbleBg.fillTriangle(0, 25, -15, 35, 15, 35);
    bubbleBg.lineStyle(3, 0x8b5cf6, 1);
    bubbleBg.lineBetween(-15, 35, 0, 25);
    bubbleBg.lineBetween(15, 35, 0, 25);

    // Hint text
    const hintText = this.add.text(0, 0, text, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#1f2937',
      wordWrap: { width: 150 },
      align: 'center'
    }).setOrigin(0.5);

    this.jumufHintBubble.add([bubbleBg, hintText]);
    this.jumufHintBubble.setDepth(100).setScrollFactor(1);

    // Animate bubble appearance
    this.jumufHintBubble.setScale(0);
    this.tweens.add({
      targets: this.jumufHintBubble,
      scale: 1,
      duration: 300,
      ease: 'Back.easeOut'
    });

    // Auto-hide after 5 seconds
    this.time.delayedCall(5000, () => {
      if (this.jumufHintBubble) {
        this.tweens.add({
          targets: this.jumufHintBubble,
          alpha: 0,
          scale: 0.8,
          duration: 300,
          ease: 'Power2.easeIn',
          onComplete: () => {
            if (this.jumufHintBubble) {
              this.jumufHintBubble.destroy();
              this.jumufHintBubble = undefined;
            }
          }
        });
      }
    });
  }

  private jumufGameOverReview() {
    if (!this.jumuf) return;

    // Show Jumuf in center
    this.showJumuf();
    this.jumuf.setPosition(400, 200);
    this.jumuf.setDepth(200);

    // Create full-screen review panel
    const panelBg = this.add.rectangle(400, 300, 600, 400, 0x1f2937, 0.95)
      .setDepth(199)
      .setScrollFactor(0);

    const panelBorder = this.add.rectangle(400, 300, 600, 400, 0x8b5cf6, 0)
      .setStrokeStyle(4, 0x8b5cf6, 1)
      .setDepth(199)
      .setScrollFactor(0);

    // Title
    const titleText = this.add.text(400, 150, '💫 Jumuf\'s Review 💫', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#fbbf24',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0);

    // Review content
    let reviewText = 'You\'ve been struggling, friend.\n\n';
    
    if (this.lastFailedSpell) {
      reviewText += `The word you tried to pronounce: "${this.lastFailedSpell}"\n\n`;
      reviewText += `Correct pronunciation: "${this.lastFailedSpell}"\n\n`;
      reviewText += 'Tips:\n';
      reviewText += '• Speak clearly and slowly\n';
      reviewText += '• Make sure your microphone is working\n';
      reviewText += '• Try saying the word syllable by syllable\n';
    } else {
      reviewText += 'You\'ve died multiple times.\n\n';
      reviewText += 'Remember:\n';
      reviewText += '• Use your spells wisely\n';
      reviewText += '• Watch out for enemies\n';
      reviewText += '• Take your time with traversal\n';
    }

    const contentText = this.add.text(400, 300, reviewText, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 550 }
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0);

    // Press Enter instruction
    const enterText = this.add.text(400, 450, 'Press ENTER to continue', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#8b5cf6',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(201).setScrollFactor(0);

    // Blink animation for Enter text
    this.tweens.add({
      targets: enterText,
      alpha: 0.5,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    // Store review panel elements for cleanup
    this.gameOverReviewPanel = {
      panelBg,
      panelBorder,
      titleText,
      contentText,
      enterText
    };
    this.gameOverReviewActive = true;
  }

  private gameOverReviewActive = false;
  private gameOverReviewEnterKey?: Phaser.Input.Keyboard.Key;
  private gameOverReviewPanel?: {
    panelBg: Phaser.GameObjects.Rectangle;
    panelBorder: Phaser.GameObjects.Rectangle;
    titleText: Phaser.GameObjects.Text;
    contentText: Phaser.GameObjects.Text;
    enterText: Phaser.GameObjects.Text;
  };

  // PronunciationDoor system
  private pronunciationDoor?: PronunciationDoor;
  private levelCompletionTriggered = false;

  public completeLevelFromDoor() {
    if (this.levelCompletionTriggered) return;
    this.levelCompletionTriggered = true;

    (window as any).__GAME_PAUSED__ = true;
    const body = this.player.body as Phaser.Physics.Arcade.Body | undefined;
    if (body) {
      body.setVelocity(0, 0);
      body.setAcceleration(0, 0);
    }

    endSession();
    showParentSummary();
  }

}

// ===========================
// PRONUNCIATION DOOR SYSTEM
// ===========================

class PronunciationDoor {
  private scene: Phaser.Scene;
  private player: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  public x: number;
  public y: number;
  private requiredWords: string[];
  private currentWordIndex = 0;
  private isUnlocked = false;
  private isListening = false;
  private isChallengeActive = false;
  private activationDistance = 220;
  private currentWordAttemptCount = 0;
  private completionTriggered = false;

  private doorSprite?: Phaser.Physics.Arcade.Sprite;
  private doorCollider?: Phaser.Physics.Arcade.Collider;
  private instructionText?: Phaser.GameObjects.Text;
  private challengeUI?: Phaser.GameObjects.Container;
  private currentWordText?: Phaser.GameObjects.Text;
  private feedbackText?: Phaser.GameObjects.Text;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    requiredWords: string[],
    _jumufGiveHint: (text: string) => void,
    _showJumuf: () => void
  ) {
    this.scene = scene;
    this.player = (scene as any).player;
    this.x = x;
    this.y = y;
    this.requiredWords = requiredWords.map((word) => word.toUpperCase().trim());
    this.create();
  }

  private create() {
    if (this.scene.textures.exists('dungeon_door')) {
      this.doorSprite = this.scene.physics.add.sprite(this.x, this.y, 'dungeon_door')
        .setDepth(10)
        .setScale(1.15)
        .setImmovable(true);
    } else {
      const doorGraphics = this.scene.add.graphics();
      doorGraphics.fillStyle(0x4b5563, 1);
      doorGraphics.fillRect(0, 0, 104, 144);
      doorGraphics.fillStyle(0x7c6f64, 1);
      doorGraphics.fillRect(6, 6, 92, 132);
      doorGraphics.fillStyle(0x5b4636, 1);
      doorGraphics.fillRect(12, 12, 80, 120);
      doorGraphics.fillStyle(0x8b5a2b, 1);
      doorGraphics.fillRect(18, 20, 68, 18);
      doorGraphics.fillRect(18, 46, 68, 18);
      doorGraphics.fillRect(18, 72, 68, 18);
      doorGraphics.fillRect(18, 98, 68, 18);
      doorGraphics.fillStyle(0x111827, 1);
      doorGraphics.fillRect(48, 54, 8, 16);
      doorGraphics.fillStyle(0xf59e0b, 1);
      doorGraphics.fillCircle(78, 70, 5);
      doorGraphics.generateTexture('pronunciation_door', 100, 140);
      doorGraphics.destroy();

      this.doorSprite = this.scene.physics.add.sprite(this.x, this.y, 'pronunciation_door')
        .setDepth(10)
        .setScale(1.15)
        .setImmovable(true);
    }

    if (!this.doorSprite) return;

    const body = this.doorSprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setSize(90, 130);

    this.doorCollider = this.scene.physics.add.collider(this.player, this.doorSprite);

    this.instructionText = this.scene.add.text(
      this.x,
      this.y - 92,
      'PRONUNCIATION GATE\nMOVE CLOSE OR PRESS G\nPRESS V TO SPEAK',
      {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#fcd34d',
        stroke: '#000000',
        strokeThickness: 3,
        align: 'center'
      }
    )
      .setOrigin(0.5)
      .setDepth(20);

    this.createChallengeUI();
    this.scene.events.on('word-spoken', this.handleWordSpoken, this);
  }

  private createChallengeUI() {
    this.challengeUI = this.scene.add.container(400, 105)
      .setDepth(100)
      .setScrollFactor(0)
      .setVisible(false)
      .setAlpha(0);

    const bg = this.scene.add.rectangle(0, 0, 480, 128, 0x111827, 0.92)
      .setStrokeStyle(2, 0xf59e0b, 1);
    this.challengeUI.add(bg);

    this.currentWordText = this.scene.add.text(0, -22, '', {
      fontFamily: 'monospace',
      fontSize: '22px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    }).setOrigin(0.5);
    this.challengeUI.add(this.currentWordText);

    this.feedbackText = this.scene.add.text(0, 22, 'Press V and say the word clearly.', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#93c5fd',
      stroke: '#000000',
      strokeThickness: 2,
      align: 'center'
    }).setOrigin(0.5);
    this.challengeUI.add(this.feedbackText);
  }

  private beginChallenge() {
    if (this.isUnlocked || this.isChallengeActive) return;

    this.isChallengeActive = true;
    this.isListening = true;

    if (this.challengeUI) {
      this.challengeUI.setVisible(true).setAlpha(1);
    }

    this.setCurrentWordText();
    if (this.instructionText) {
      this.instructionText.setText('PRONUNCIATION CHALLENGE ACTIVE\nPRESS V TO SPEAK');
    }
  }

  private setCurrentWordText() {
    if (!this.currentWordText) return;
    this.currentWordAttemptCount = 0;
    const currentWord = this.requiredWords[this.currentWordIndex];
    this.currentWordText.setText(
      `Say: ${currentWord} (${this.currentWordIndex + 1}/${this.requiredWords.length})`
    );
  }

  private setFeedbackText(message: string, color: string) {
    if (!this.feedbackText) return;
    this.feedbackText.setText(message);
    this.feedbackText.setColor(color);
  }

  private isWordMatch(spoken: string, required: string): boolean {
    if (spoken === required) return true;
    if (spoken.includes(required)) return true;
    if (required.includes(spoken) && spoken.length >= Math.max(3, required.length - 2)) return true;

    const wordBoundaryRegex = new RegExp(`\\b${required}\\b`, 'i');
    return wordBoundaryRegex.test(spoken);
  }

  private handleWordSpoken(spokenWord: string) {
    if (this.isUnlocked || !this.isListening || this.currentWordIndex >= this.requiredWords.length) {
      return;
    }

    const normalizedSpoken = spokenWord.toUpperCase().trim();
    const currentRequired = this.requiredWords[this.currentWordIndex];
    this.currentWordAttemptCount++;

    if (this.isWordMatch(normalizedSpoken, currentRequired)) {
      trackDoorWordResult(currentRequired, true);
      this.currentWordIndex++;

      if (this.currentWordIndex >= this.requiredWords.length) {
        this.setFeedbackText('Correct! Door unlocked.', '#86efac');
        this.unlockDoor();
        return;
      }

      this.setFeedbackText('Correct. Next word.', '#86efac');
      this.setCurrentWordText();
      return;
    }

    if (this.currentWordAttemptCount === 1) {
      trackDoorWordResult(currentRequired, false);
    }
    this.setFeedbackText(`Try again: ${currentRequired}`, '#fca5a5');
  }

  private unlockDoor() {
    this.isUnlocked = true;
    this.isListening = false;
    this.isChallengeActive = false;

    if (this.instructionText) {
      this.instructionText
        .setText('DOOR OPEN')
        .setColor('#86efac');
    }

    if (this.doorCollider) {
      this.doorCollider.destroy();
      this.doorCollider = undefined;
    }

    if (this.doorSprite) {
      this.doorSprite
        .setTint(0x86efac)
        .setAlpha(0.6);
    }
    if (this.challengeUI) {
      this.challengeUI.setVisible(false);
    }
  }

  public startListening() {
    this.beginChallenge();
  }

  public isChallengeRunning(): boolean {
    return this.isChallengeActive && !this.isUnlocked;
  }

  public update() {
    if (this.isUnlocked) {
      if (!this.completionTriggered && this.doorSprite) {
        const playerBounds = this.player.getBounds();
        const doorBounds = this.doorSprite.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(playerBounds, doorBounds)) {
          this.completionTriggered = true;
          (this.scene as any).completeLevelFromDoor?.();
        }
      }
      return;
    }

    const distanceToPlayer = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.x,
      this.y
    );

    if (!this.isChallengeActive && distanceToPlayer <= this.activationDistance) {
      this.beginChallenge();
      return;
    }

    if (this.instructionText && !this.isChallengeActive) {
      this.instructionText.setAlpha(distanceToPlayer <= 320 ? 1 : 0.75);
    }

    if (this.isChallengeActive && this.currentWordText) {
      if (distanceToPlayer > 480) {
        this.setFeedbackText('Move closer, then press V to continue.', '#fcd34d');
      } else if (this.feedbackText?.text === 'Move closer, then press V to continue.') {
        this.setFeedbackText('Press V and say the word clearly.', '#93c5fd');
      }
    }
  }

  public destroy() {
    this.scene.events.off('word-spoken', this.handleWordSpoken, this);
    if (this.doorSprite) this.doorSprite.destroy();
    if (this.challengeUI) this.challengeUI.destroy();
    if (this.instructionText) this.instructionText.destroy();
    if (this.doorCollider) this.doorCollider.destroy();
  }
}
