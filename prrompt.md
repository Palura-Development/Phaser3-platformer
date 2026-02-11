# Cave Runner — Web-Based Node Traversal System (Cursor Guardrails)

## READ FIRST — OPERATING MODE

You are modifying an **existing web-based 2D game** built with:

- HTML
- CSS
- Vanilla JavaScript

This game already has:
- Player movement (WORKING)
- Sword hotkeys (WORKING)
- Speech spell system (WORKING)

❗ Your task is ONLY to add the **Node + Word Traversal system**.
❗ Do NOT refactor, rewrite, or break existing systems.

If something is unclear, ASK before implementing. Do NOT guess.

---

## ABSOLUTE CONSTRAINTS (NON-NEGOTIABLE)

- ❌ Do NOT modify player movement logic
- ❌ Do NOT modify sword hotkeys
- ❌ Do NOT modify speech spell logic
- ❌ Do NOT rewrite the main game loop
- ❌ Do NOT introduce frameworks (Phaser, Unity, Three.js, etc.)
- ❌ Do NOT add tutorials, menus, or popups

You may ONLY add new, modular code for node-based traversal.

---

## FEATURE TO IMPLEMENT

### Feature Name
**Word-Based Node Traversal (Hook v1)**

### Purpose
Allow the player to:
1. Enter Hook Mode
2. Select letter nodes in the environment
3. Form a word
4. Resolve traversal through the selected nodes

This must coexist cleanly with all existing mechanics.

---

## CORE LOOP (LOCKED)

Normal Movement
→ Press Hook Key
→ Select Letter Nodes
→ Word Forms
→ Player Traverses Nodes
→ Return to Normal Movement


No instructions. No UI explanations. The level teaches the mechanic.

---

## INPUTS

You may ADD:
- `H` → Toggle Hook Mode
- Mouse Click → Select Node

You may NOT override:
- Existing movement keys
- Existing sword keys
- Existing speech triggers

---

## HOOK MODE RULES

- Activated by pressing `H`
- While Hook Mode is active:
  - Player movement is DISABLED
  - Sword attacks should NOT trigger
  - Speech spells should NOT trigger
  - Letter nodes become clickable

Exiting Hook Mode:
- After traversal completes
- OR pressing `Escape`

---

## LETTER NODES

Each node must:
- Exist at a fixed position
- Contain ONE letter
- Be selectable only in Hook Mode

Each node must expose:
```js
{
  id,
  letter,
  x,
  y,
  selectable
}
Nodes can be DOM elements or canvas objects depending on the existing game.

WORD BUFFER
Implement a simple buffer:

let currentWord = [];
let selectedNodes = [];
On node click:

Append letter to currentWord

Append node to selectedNodes

Lock node so it cannot be reselected

Visually highlight node in selection order

❌ No dictionary validation
❌ No scoring
❌ No progression logic

TRAVERSAL RESOLUTION (CRITICAL)
When traversal resolves:

Player moves through selectedNodes IN ORDER

Movement is:

Non-physics based

Instant or lerped

Not interruptible

Player ends at final node position

During traversal:

Disable normal movement

Ignore collisions if necessary

After traversal:

Clear word buffer

Unlock nodes

Exit Hook Mode

Restore normal movement

Traversal must be ATOMIC (cannot be interrupted).

FAILURE & CANCEL RULES
Clicking invalid node → ignore

Cancelling Hook Mode → clear buffer

No penalties

No damage

No game over logic

UI (MINIMAL ONLY)
Allowed:

Simple word display (letters selected)

Node highlight on selection

Disallowed:

Tutorials

Instructions

Tooltips

Menus

Popups

FILE STRUCTURE (SUGGESTED, NOT REQUIRED)
You may ADD:

hookMode.js

nodes.js

wordBuffer.js

traversal.js

You may NOT:

Rewrite existing player or input files

Rename existing files

Change global architecture

EVENT FLOW (REFERENCE)
H pressed
→ enterHookMode()

Node clicked
→ addLetterToBuffer()

Traversal triggered
→ resolveTraversal()

Traversal complete
→ exitHookMode()
INTEGRATION RULES
All new logic must be opt-in

When Hook Mode is OFF, the game must behave EXACTLY as before

Avoid global variables unless the project already uses them

SUCCESS CONDITIONS
Player can traverse gaps using letter nodes

Existing movement, sword, and speech systems still work

No regressions

Code is readable and easy to iterate on

FINAL INSTRUCTION
Implement ONLY the node-based word traversal system described above.
Do NOT add new mechanics.
Do NOT expand scope.
Do NOT refactor existing systems.

If unsure, ASK.

