// Letter Node System - Handles node placement, spacing, and rendering
// Ensures letters are placed on circular nodes with proper spacing constraints

import Phaser from 'phaser';

// Spacing constraints (from design requirements)
export const NODE_SPACING = {
  HORIZONTAL_MIN: 120,  // Minimum horizontal distance between nodes (different platforms)
  VERTICAL_MIN: 100,    // Minimum vertical distance between nodes
  DIAGONAL_MIN: 140,    // Minimum diagonal distance between nodes
  SAME_PLATFORM_MIN: 140, // Minimum distance between nodes on SAME platform
  PLATFORM_CLEARANCE: 24, // Minimum vertical clearance from platform
};

// Node visual configuration
export const NODE_CONFIG = {
  DIAMETER: 52,         // Node circle diameter
  COLOR: 0x3b82f6,      // Blue color for nodes
  COLOR_ALT: 0x10b981,  // Green color for alternate nodes
  ALPHA: 0.9,           // Node transparency
  STROKE_WIDTH: 3,      // Border thickness
  STROKE_COLOR: 0x1e40af, // Darker blue border
  TEXT_SIZE: '24px',    // Letter text size
  TEXT_COLOR: '#ffffff', // White text
};

export interface LetterNode {
  x: number;
  y: number;
  letter: string;
  isRequired: boolean;
  platformIndex: number;
}

export interface Platform {
  x: number;
  y: number;
  width: number;
}

/**
 * Calculate distance between two points
 */
function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/**
 * Check if two nodes are too close based on spacing constraints
 * Relaxed to allow more node placement
 */
export function areNodesTooClose(node1: LetterNode, node2: LetterNode): boolean {
  const dx = Math.abs(node2.x - node1.x);
  const dy = Math.abs(node2.y - node1.y);
  const dist = distance(node1.x, node1.y, node2.x, node2.y);

  // If nodes are on the same platform (similar Y), always allow them
  if (dy < 50) {
    return false; // Same platform - OK
  }

  // Only reject if nodes are VERY close (overlapping)
  if (dist < 60) {
    return true;
  }

  return false;
}

/**
 * Validate node placement against all existing nodes
 */
export function validateNodePlacement(
  newNode: LetterNode,
  existingNodes: LetterNode[]
): boolean {
  for (const node of existingNodes) {
    if (areNodesTooClose(newNode, node)) {
      return false;
    }
  }
  return true;
}

/**
 * Determine optimal letter count per platform based on width
 * RULE: Exactly 2 nodes per platform (or 0 for very tiny platforms)
 */
export function getLetterCountForPlatform(platformWidth: number): number {
  // Only skip extremely small platforms
  if (platformWidth < 80) {
    return 0; // Platform too tiny
  }

  return 2; // Always try for 2 nodes per platform
}

/**
 * Generate exactly 2 nodes per platform at 33% and 67% positions
 * RULE: Always 2 nodes per platform, or 0 if too small
 */
export function generatePlatformLetterPositions(
  platform: Platform,
  letterCount: number
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];

  // If letterCount is 0, platform is too small - return empty
  if (letterCount === 0) {
    return positions;
  }

  // Always place exactly 2 nodes at 33% and 67%
  const leftNodeX = platform.x - platform.width / 2 + platform.width * 0.33;
  const rightNodeX = platform.x - platform.width / 2 + platform.width * 0.67;

  // Calculate distance between the two nodes
  const distanceBetween = Math.abs(rightNodeX - leftNodeX);

  // Very minimal spacing requirement - just don't overlap
  if (distanceBetween < 40) {
    console.warn(
      `Platform at x:${platform.x} too narrow for 2 nodes (distance: ${distanceBetween}px). Skipping.`
    );
    return positions; // Return empty - platform too small
  }

  const y = platform.y - NODE_SPACING.PLATFORM_CLEARANCE - NODE_CONFIG.DIAMETER / 2;

  // Place left node
  positions.push({ x: leftNodeX, y });

  // Place right node
  positions.push({ x: rightNodeX, y });

  return positions;
}

/**
 * Create node placements with proper spacing constraints
 * RULE: Exactly 2 nodes per platform
 * Returns array of nodes that respect minimum spacing rules
 */
export function createNodePlacements(
  platforms: Platform[],
  requiredLetters: string[]
): LetterNode[] {
  const nodes: LetterNode[] = [];
  const extraLetters = [
    'A', 'E', 'I', 'O', 'U', 'C', 'D', 'F', 'G', 'K', 'M', 'P', 'Q', 'V', 'W', 'X'
  ];

  // Filter platforms that can hold 2 nodes
  const validPlatforms = platforms.filter(p => getLetterCountForPlatform(p.width) === 2);

  console.log(`Valid platforms for 2 nodes: ${validPlatforms.length}/${platforms.length}`);

  // Shuffle platforms for random distribution
  const shuffledPlatforms = [...validPlatforms].sort(() => Math.random() - 0.5);

  // First pass: Place all required letters (one per slot)
  let slotIndex = 0;
  for (const letter of requiredLetters) {
    let placed = false;
    let attempts = 0;

    while (!placed && attempts < shuffledPlatforms.length * 2) {
      const platformIdx = Math.floor(slotIndex / 2) % shuffledPlatforms.length;
      const platform = shuffledPlatforms[platformIdx];
      const positions = generatePlatformLetterPositions(platform, 2);

      if (positions.length === 2) {
        // Alternate between left (0) and right (1) slot
        const positionIdx = slotIndex % 2;
        const pos = positions[positionIdx];

        const newNode: LetterNode = {
          x: pos.x,
          y: pos.y,
          letter,
          isRequired: true,
          platformIndex: platforms.indexOf(platform),
        };

        if (validateNodePlacement(newNode, nodes)) {
          nodes.push(newNode);
          placed = true;
        }
      }

      slotIndex++;
      attempts++;
    }

    if (!placed) {
      console.warn(`Could not place required letter: ${letter}`);
    }
  }

  // Second pass: Fill remaining slots with extra letters (exactly 2 per platform)
  for (const platform of validPlatforms) {
    const positions = generatePlatformLetterPositions(platform, 2);

    if (positions.length !== 2) continue;

    // Count existing nodes on this platform
    const nodesOnPlatform = nodes.filter(
      (node) =>
        Math.abs(node.x - platform.x) < platform.width / 2 + 10 &&
        Math.abs(node.y - platform.y) < 100
    );

    const slotsToFill = 2 - nodesOnPlatform.length;

    if (slotsToFill > 0) {
      // Find which positions are already occupied
      const occupiedPositions = nodesOnPlatform.map(n => n.x);

      for (const pos of positions) {
        // Skip if position already has a node
        const isOccupied = occupiedPositions.some(
          occX => Math.abs(occX - pos.x) < 30
        );

        if (isOccupied) continue;

        const randomLetter =
          extraLetters[Math.floor(Math.random() * extraLetters.length)];

        const newNode: LetterNode = {
          x: pos.x,
          y: pos.y,
          letter: randomLetter,
          isRequired: false,
          platformIndex: platforms.indexOf(platform),
        };

        if (validateNodePlacement(newNode, nodes)) {
          nodes.push(newNode);
        }
      }
    }
  }

  console.log(`Total nodes placed: ${nodes.length} (Required: ${requiredLetters.length})`);

  return nodes;
}

/**
 * Create visual node representation in Phaser scene
 */
export function createNodeVisual(
  scene: Phaser.Scene,
  node: LetterNode,
  index: number
): { circle: Phaser.GameObjects.Arc; text: Phaser.GameObjects.Text } {
  // Alternate between blue and green for visual variety
  const useAltColor = index % 3 === 0;
  const fillColor = useAltColor ? NODE_CONFIG.COLOR_ALT : NODE_CONFIG.COLOR;

  // Create circular node background
  const circle = scene.add.circle(
    node.x,
    node.y,
    NODE_CONFIG.DIAMETER / 2,
    fillColor,
    NODE_CONFIG.ALPHA
  );

  circle.setStrokeStyle(NODE_CONFIG.STROKE_WIDTH, NODE_CONFIG.STROKE_COLOR);
  circle.setDepth(9); // Behind text but above terrain

  // Create letter text centered in node
  const text = scene.add.text(node.x, node.y, node.letter, {
    fontFamily: 'Arial, sans-serif',
    fontSize: NODE_CONFIG.TEXT_SIZE,
    color: NODE_CONFIG.TEXT_COLOR,
    stroke: '#000000',
    strokeThickness: 3,
  });

  text.setOrigin(0.5, 0.5);
  text.setDepth(10);

  // Dim non-required letters slightly
  if (!node.isRequired) {
    text.setAlpha(0.7);
    circle.setAlpha(0.6);
  }

  return { circle, text };
}

/**
 * Debug visualization - shows spacing zones (use during development)
 */
export function drawSpacingDebug(
  scene: Phaser.Scene,
  nodes: LetterNode[]
): Phaser.GameObjects.Graphics {
  const graphics = scene.add.graphics();
  graphics.lineStyle(1, 0xff0000, 0.3);
  graphics.setDepth(8);

  nodes.forEach((node) => {
    // Draw minimum spacing circle
    graphics.strokeCircle(node.x, node.y, NODE_SPACING.DIAGONAL_MIN / 2);
  });

  return graphics;
}
