# CTM API Reference

## Smart Contract Interface

### Contract Information
- **Name**: Gawi Bawi Bo ZK
- **Platform**: Stellar Soroban
- **Language**: Rust
- **Version**: 1.0.0

### Network Deployment
```typescript
const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDM2VXXHUAUTC5SKU2GZ5CSQJBAUPC4BOJHJTI2M4XP3CWYGBBEQLJUQ",
  }
}
```

## Contract Methods

### Game Lifecycle

#### `start_game`
Initialize a new game between two players.

**Parameters:**
- `player1: Address` - First player's Stellar address
- `player2: Address` - Second player's Stellar address
- `player1_points: i128` - Points staked by player 1
- `player2_points: i128` - Points staked by player 2

**Returns:** `u32` - Unique session ID for the game

**Auth:** Requires signatures from both players

**Events Emitted:**
- `GameStarted(session_id, player1, player2)`

---

#### `commit_hands`
Commit to two hand selections using cryptographic hash.

**Parameters:**
- `session_id: u32` - Game session identifier
- `player: Address` - Committing player's address
- `hands_hash: BytesN<32>` - keccak256 hash of hand selections

**Returns:** `Result<(), Error>`

**Auth:** Requires signature from committing player

**Preconditions:**
- Game must be in phase 1 (CommitHands)
- Player must not have already committed
- Player must be participant in game

---

#### `reveal_hands`
Reveal actual hand selections and verify against commitment.

**Parameters:**
- `session_id: u32` - Game session identifier
- `player: Address` - Revealing player's address
- `left_hand: u32` - First hand selection (0=rock, 1=paper, 2=scissors)
- `right_hand: u32` - Second hand selection (0=rock, 1=paper, 2=scissors)
- `salt: BytesN<32>` - Random salt used in commitment hash

**Returns:** `Result<(), Error>`

**Auth:** Requires signature from revealing player

**Validation:**
- Hash verification: `keccak256(left_hand || right_hand || salt) == hands_hash`
- Hand validation: `left_hand != right_hand`, both in range [0,2]

---

#### `commit_choice`
Commit to which hand to keep for final duel.

**Parameters:**
- `session_id: u32` - Game session identifier
- `player: Address` - Committing player's address
- `choice_hash: BytesN<32>` - keccak256 hash of choice selection

**Returns:** `Result<(), Error>`

**Auth:** Requires signature from committing player

**Preconditions:**
- Game must be in phase 3 (CommitChoice)
- Player must have revealed hands in phase 2

---

#### `reveal_choice`
Reveal chosen hand and resolve the game.

**Parameters:**
- `session_id: u32` - Game session identifier
- `player: Address` - Revealing player's address
- `choice_index: u32` - Which hand to keep (0=left, 1=right)
- `salt: BytesN<32>` - Random salt used in choice commitment

**Returns:** `Result<(), Error>`

**Auth:** Requires signature from revealing player

**Effects:**
- Verifies choice commitment
- Determines winner using RPS rules
- Updates game state to Complete
- Calls GameHub.end_game()

---

### Noir proofs (integrated support)

CTM includes a supported Noir proof workflow: frontends and tournament infrastructure generate proofs off-chain using CTM's example circuits and helper scripts, then publish proof artifacts and attach short references to game transactions or scoreboard entries.

Suggested fields and flow (frontend):
  1. **Generate proof off-chain** for the desired assertion (e.g., "hands are valid and different").
  2. **Publish proof** to an off-chain verifier or IPFS and obtain a short reference (CID or signed attestation).
  3. **Attach reference** to the corresponding transaction (e.g., include CID in transaction memo or store in an off-chain scoreboard tied to `session_id`).

Notes:
  - The on-chain contract continues to verify by recomputing `keccak256(...)`. Noir proofs are auxiliary but first-class: used for independent auditors, competitive tournament rules, and enhanced UX assurances.
  - For teams requiring on-chain verification, CTM provides guidance on building a verifier contract; be aware this increases cost and complexity.

---

---

#### `get_game`
Query current game state.

**Parameters:**
- `session_id: u32` - Game session identifier

**Returns:** `Result<Game, Error>` - Complete game state

**Auth:** None (read-only)

## Data Types

### Game Struct
```rust
struct Game {
    player1: Address,
    player2: Address,
    player1_points: i128,
    player2_points: i128,
    phase: u32,

    // Phase 1 commitments
    p1_commit: Option<BytesN<32>>,
    p2_commit: Option<BytesN<32>>,

    // Phase 2+ revealed hands
    p1_left: Option<u32>,
    p1_right: Option<u32>,
    p2_left: Option<u32>,
    p2_right: Option<u32>,

    // Phase 3 choice commitments
    p1_choice_commit: Option<BytesN<32>>,
    p2_choice_commit: Option<BytesN<32>>,

    // Phase 4+ final choices and winner
    p1_kept: Option<u32>,
    p2_kept: Option<u32>,
    winner: Option<Address>,
}
```

### Phase Values
- `1` - CommitHands
- `2` - RevealHands
- `3` - CommitChoice
- `4` - RevealChoice
- `5` - Complete

### Hand Values
- `0` - Rock
- `1` - Paper
- `2` - Scissors

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 1 | GameNotFound | Specified game session doesn't exist |
| 2 | NotPlayer | Caller is not a participant in this game |
| 3 | WrongPhase | Operation not allowed in current game phase |
| 4 | AlreadyCommitted | Player has already committed in this phase |
| 5 | InvalidHand | Hand value out of valid range [0,2] |
| 6 | HandsMustDiffer | Both hands cannot be the same |
| 7 | HashMismatch | Revealed values don't match commitment hash |
| 8 | InvalidChoice | Choice index out of valid range [0,1] |
| 9 | GameAlreadyEnded | Game has already been completed |

## Events

### GameStarted
Emitted when a new game begins.

**Fields:**
- `session_id: u32`
- `player1: Address`
- `player2: Address`

### HandsCommitted
Emitted when a player commits to hand selections.

**Fields:**
- `session_id: u32`
- `player: Address`
- `hands_hash: BytesN<32>`

### HandsRevealed
Emitted when a player reveals hand selections.

**Fields:**
- `session_id: u32`
- `player: Address`
- `left_hand: u32`
- `right_hand: u32`

### ChoiceCommitted
Emitted when a player commits to hand choice.

**Fields:**
- `session_id: u32`
- `player: Address`
- `choice_hash: BytesN<32>`

### ChoiceRevealed
Emitted when a player reveals final choice.

**Fields:**
- `session_id: u32`
- `player: Address`
- `kept_hand: u32`

### GameCompleted
Emitted when game ends with winner.

**Fields:**
- `session_id: u32`
- `winner: Address`
- `p1_final_hand: u32`
- `p2_final_hand: u32`

## Frontend API

### CtmService Class

#### Constructor
```typescript
new CtmService(contractId: string)
```

#### Game Setup Methods
```typescript
prepareStartGame(
  sessionId: number,
  player1Addr: string,
  placeholderAddr: string,
  points: number,
  signer: Keypair
): Promise<string> // Returns XDR

importAndSignAuthEntry(
  authXdr: string,
  player2Addr: string,
  points: number,
  signer: Keypair
): Promise<string> // Returns full XDR

finalizeStartGame(
  fullXdr: string,
  finalAddr: string,
  signer: Keypair
): Promise<void>
```

#### Game Action Methods
```typescript
commitHands(
  sessionId: number,
  playerAddr: string,
  handsHash: Buffer,
  signer: Keypair
): Promise<void>

revealHands(
  sessionId: number,
  playerAddr: string,
  leftHand: number,
  rightHand: number,
  salt: Uint8Array,
  signer: Keypair
): Promise<void>

commitChoice(
  sessionId: number,
  playerAddr: string,
  choiceHash: Buffer,
  signer: Keypair
): Promise<void>

revealChoice(
  sessionId: number,
  playerAddr: string,
  choiceIndex: number,
  salt: Uint8Array,
  signer: Keypair
): Promise<void>
```

#### Query Methods
```typescript
getGame(sessionId: number): Promise<Game>
parseAuthEntry(xdr: string): AuthEntryData
```

### Cryptographic Helpers

#### Hash Generation
```typescript
computeHandsHash(
  leftHand: number,
  rightHand: number,
  salt: Uint8Array
): Buffer

computeChoiceHash(
  choiceIndex: number,
  salt: Uint8Array
): Buffer
```

#### Salt Generation
```typescript
generateSalt(): Uint8Array // 32 random bytes
```

## Integration Examples

### Starting a Game (Player 1)
```typescript
const ctmService = new CtmService(CONTRACT_ID);

// Generate auth entry XDR
const authXdr = await ctmService.prepareStartGame(
  sessionId,
  player1Address,
  placeholderAddress,
  points,
  player1Signer
);

// Share authXdr with Player 2
```

### Joining a Game (Player 2)
```typescript
// Import and sign auth entry
const fullXdr = await ctmService.importAndSignAuthEntry(
  authXdr,
  player2Address,
  points,
  player2Signer
);

// Finalize game start
await ctmService.finalizeStartGame(
  fullXdr,
  player2Address,
  player2Signer
);
```

### Playing the Game
```typescript
// Commit hands
const salt = generateSalt();
const handsHash = computeHandsHash(0, 1, salt); // Rock + Paper
await ctmService.commitHands(sessionId, playerAddr, handsHash, signer);

// Reveal hands
await ctmService.revealHands(sessionId, playerAddr, 0, 1, salt, signer);

// Commit choice
const choiceSalt = generateSalt();
const choiceHash = computeChoiceHash(0, choiceSalt); // Keep left hand
await ctmService.commitChoice(sessionId, playerAddr, choiceHash, signer);

// Reveal choice
await ctmService.revealChoice(sessionId, playerAddr, 0, choiceSalt, signer);
```

## Transaction Fees

### Estimated Costs (Testnet)
- `start_game`: ~0.1 XLM
- `commit_hands`: ~0.05 XLM
- `reveal_hands`: ~0.08 XLM
- `commit_choice`: ~0.05 XLM
- `reveal_choice`: ~0.08 XLM
- `get_game`: ~0.01 XLM

### Fee Optimization
- Batch operations where possible
- Use efficient data structures
- Minimize storage operations
- Leverage Soroban optimizations

## Rate Limits

### Contract Limits
- Maximum concurrent games: Unlimited (storage constrained)
- Game TTL: 30 days
- Transaction timeout: 5 minutes

### Frontend Limits
- Polling interval: 2 seconds
- Max retry attempts: 3
- Request timeout: 30 seconds

## Error Handling

### Contract Errors
All contract errors are mapped to user-friendly messages in the frontend:

```typescript
const errorMessages = {
  1: "Game not found",
  2: "You are not a player in this game",
  3: "Action not allowed in current game phase",
  // ... etc
}
```

### Network Errors
- Connection failures: Automatic retry with exponential backoff
- Timeout errors: User notification with retry option
- Invalid transactions: Detailed error messages

### Validation Errors
- Client-side validation prevents invalid inputs
- Server-side validation ensures contract integrity
- Comprehensive error boundaries in React components