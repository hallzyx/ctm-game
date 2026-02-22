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