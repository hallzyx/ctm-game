# CTM (Commit-Turn-Move) Game

A zero-knowledge powered strategic rock-paper-scissors variant built on Stellar Soroban.

## Overview

CTM is a two-player game that combines traditional rock-paper-scissors with strategic commitment mechanics. Players secretly commit to two different hands, reveal them simultaneously, then strategically choose which hand to keep for the final duel. Zero-knowledge proofs ensure fair play while maintaining strategic depth.

## Game Rules

### Basic Concept
Each player selects **two different hands** (rock, paper, scissors) and commits to them secretly. After both players reveal their hands, each player chooses **one hand to keep** for a classic rock-paper-scissors duel.

### Hand Values
- 🪨 **Rock** (0)
- ✋ **Paper** (1)
- ✌️ **Scissors** (2)

### Winning Logic
Standard rock-paper-scissors rules apply to the final kept hands:
- Rock beats Scissors
- Paper beats Rock
- Scissors beats Paper
- Ties go to Player 1 (by convention)

## Game Phases

### Phase 1: Commit Hands
- Both players secretly select two different hands
- Submit cryptographic commitments (keccak256 hashes)
- Cannot change selections once committed

### Phase 2: Reveal Hands
- Both players reveal their actual hand selections
- Contract verifies commitments match revealed values
- All four hands become visible to both players

### Phase 3: Commit Choice
- Players strategically choose which hand to keep
- Submit new cryptographic commitments for their choice
- Opponent's hands are visible for strategic decision-making

### Phase 4: Reveal Choice
- Both players reveal their chosen hand
- Contract verifies choice commitments
- Determines winner using rock-paper-scissors rules

### Phase 5: Complete
- Game ends with winner declared
- Results are final and recorded on-chain

## Zero-Knowledge Implementation

### Commitment Scheme
- Uses keccak256 hashing with random salts
- Hands commitment: `keccak256(left_hand || right_hand || salt_32bytes)`
- Choice commitment: `keccak256(choice_index || salt_32bytes)`

### Security Properties
- **Hiding**: Opponent cannot learn your selections until reveal
- **Binding**: Cannot change selections after commitment
- **Verifiable**: Contract can verify revealed values match commitments

### Noir integration (integrated feature)

CTM includes built-in support for Noir circuits and an off-chain proving workflow to provide stronger privacy and richer assertions than hash-only commit–reveal. Noir proofs are treated as a first-class feature of the game stack and are used by the frontend and tournament tooling to produce auditable, privacy-preserving attestations.

- Phase uses and benefits:
	- **Phase 1 (Commit Hands)**: CTM's Noir circuit proves that the committed preimage encodes *two different valid hands* (0,1,2) without revealing which ones. This prevents malformed commitments and enforces the "hands must differ" rule privately.
	- **Phase 2 (Reveal Hands)**: The prover can produce an optional attestation that links the original commitment to the revealed hands; useful for off-chain auditors and tournament scorekeepers while the contract's keccak256 check remains canonical.
	- **Phase 3 (Commit Choice)**: The Noir circuit asserts that `choice_index ∈ {0,1}` and that the choice refers to one of the previously revealed hands — without leaking which one — increasing competitive privacy for advanced tournament modes.
	- **Phase 4 (Reveal Choice)**: A proof can attest that the revealed choice matches the earlier committed preimage; off-chain verifiers can validate this quickly without reprocessing salts.

- Integration pattern (how we use it in CTM):
	1. Frontend runs the Noir prover (local or trusted prover service) to produce a proof and public inputs when a player commits or before a reveal step.
	2. Proof artifacts are stored off-chain (IPFS or a prover API) and a short reference (CID or signed attestation) is attached to the transaction memo or saved in the game scoreboard service tied to `session_id`.
	3. Tournament backends or third-party verifiers fetch the proof by reference and verify the public inputs against the contract's stored commitments.

The on-chain contract remains the authoritative guardrail (recomputing keccak256), while Noir proofs provide privacy, auditability, and richer rule assertions for competitive play.

## Technical Architecture

### Smart Contract
- **Name**: Gawi Bawi Bo ZK
- **Platform**: Stellar Soroban
- **Language**: Rust
- **ZK Library**: Built-in keccak256

### Frontend
- **Framework**: React + TypeScript + Vite
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Wallet**: Stellar SDK integration

### Integration
- Contract bindings generated via Soroban CLI
- TypeScript service layer (`ctmService.ts`)
- Real-time game state polling

## API Reference

### Contract Methods

#### `start_game(player1, player2, player1_points, player2_points) -> session_id`
Initialize a new game between two players.

#### `commit_hands(session_id, player, hands_hash)`
Commit to two hand selections using cryptographic hash.

#### `reveal_hands(session_id, player, left_hand, right_hand, salt)`
Reveal actual hand selections and verify against commitment.

#### `commit_choice(session_id, player, choice_hash)`
Commit to which hand to keep for final duel.

#### `reveal_choice(session_id, player, choice_index, salt)`
Reveal chosen hand and resolve game.

#### `get_game(session_id) -> Game`
Get current game state.

### Frontend Components

#### `CtmGame`
Main game component handling all phases and UI state.

#### `CtmService`
TypeScript service wrapping contract interactions.

## Development

### Prerequisites
- Rust + Soroban CLI
- Node.js + Bun
- Stellar testnet access

### Setup
```bash
# Install dependencies
bun install

# Build and deploy contract
bun run setup

# Scaffold CTM frontend
bun run create ctm

# Run development server
bun run dev:game ctm
```

### Testing
```bash
# Run contract tests
cd contracts/ctm
cargo test

# Run frontend tests
cd ctm-frontend
npm test
```

## Deployment

### Testnet
```bash
bun run deploy:contracts
bun run build:frontend ctm
```

### Production
```bash
bun run publish ctm --build
```

## Security Considerations

- All commitments are cryptographically binding
- Salts must be randomly generated and kept secret until reveal
- Contract validates all state transitions
- No trusted third parties required

## Future Enhancements

- Noir circuit integration for off-chain proofs
- Tournament support via Game Hub
- Multi-round games
- Time-based commitments with deadlines