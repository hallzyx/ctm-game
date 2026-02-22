# CTM - Commit-Turn-Move: Zero-Knowledge Rock-Paper-Scissors

## Overview

CTM (Commit-Turn-Move) is an innovative zero-knowledge powered variant of the classic rock-paper-scissors game, built on the Stellar blockchain using Soroban smart contracts. In this strategic two-player game, players engage in a multi-phase commitment and reveal mechanism that adds layers of tactical depth to traditional RPS gameplay.

The game is inspired by the Korean "Gawi Bawi Bo" (double rock-paper-scissors), where players secretly commit to two different hands, reveal them, and then strategically choose which hand to keep for the final duel. Zero-knowledge cryptography ensures that commitments remain hidden until the appropriate reveal phase, preventing cheating and maintaining game integrity.

## How to Play

CTM unfolds in five distinct phases:

1. **Commit Hands**: Both players secretly commit to two different hands (rock, paper, or scissors) using a cryptographic hash. They submit `keccak256(left_hand || right_hand || salt)` without revealing their choices.

2. **Reveal Hands**: Players reveal their actual hands and the salt used in the hash. The contract verifies the commitment matches the revealed values.

3. **Commit Choice**: Each player commits to which of their two hands they want to keep for the final duel, again using a hash commitment.

4. **Reveal Choice**: Players reveal their choice of which hand to keep. The contract verifies and determines the winner based on classic RPS rules.

5. **Complete**: The game resolves, and the winner is declared. In case of a tie, player 1 wins by convention.

## Key Features

- **Zero-Knowledge Commitments**: Uses keccak256 hashing to ensure commitments are binding without premature revelation.
- **Strategic Depth**: Players must think ahead, committing to two hands and then choosing the optimal one based on the opponent's revealed hands.
- **Blockchain Security**: Built on Stellar Soroban for decentralized, trustless gameplay.
- **Modern Frontend**: TypeScript-based UI with a sleek "Arena" design theme.
- **Game Hub Integration**: Seamlessly integrates with the Stellar Game Studio ecosystem for session management and scoring.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/jamesbachini/Stellar-Game-Studio
cd Stellar-Game-Studio

# Install dependencies
bun install

# Set up testnet environment
bun run setup

# Run the CTM game frontend
bun run dev:game ctm
```

## Architecture

CTM leverages Stellar Soroban smart contracts for game logic, with a React-based frontend for user interaction. The contract implements a state machine across five phases, using temporary storage with TTL for game sessions. Zero-knowledge is achieved through hash-based commit-reveal schemes, with optional Noir circuit integration for off-chain proof generation.

## Documentation

For detailed information about CTM, refer to the following documentation files:

- **[Game Overview](./docs/ctm/README.md)**: Comprehensive introduction to CTM gameplay and features.
- **[Architecture](./docs/ctm/architecture.md)**: Technical architecture, smart contract design, and system components.
- **[Game Rules](./docs/ctm/game-rules.md)**: Detailed gameplay rules, strategies, and examples.
- **[API Reference](./docs/ctm/api-reference.md)**: Complete contract methods, frontend APIs, and integration guides.
- **[Development Guide](./docs/ctm/development.md)**: Setup instructions, testing, deployment, and contribution guidelines.

## Built with Stellar Game Studio

This game was developed using Stellar Game Studio, a toolkit for building Web3 games on Stellar. It provides battle-tested Soroban patterns, ready-made frontend stacks, and deployment automation to accelerate game development.

**Built with ❤️ for Stellar developers**

## 📄 License

MIT License - see LICENSE file
