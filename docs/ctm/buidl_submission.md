# CTM — Commit·Turn·Move (BUIDL Submission)

CTM is a zero-knowledge-enhanced variant of Rock–Paper–Scissors inspired by the Korean "Gawi Bawi Bo" double-RPS. Two players each commit two different hands, reveal them, then secretly commit which hand they keep for the final duel. The protocol uses hash-based commit–reveal (keccak256) to prevent cheating and preserve fairness while enabling strategic gameplay.

Why CTM is novel

- Strategic depth: requiring two-hand commitments then a selection phase creates meaningful mind games beyond single-shot RPS.
- Simple, auditable ZK: commitments use standard keccak256 preimages (left||right||salt, choice||salt). This is lightweight, compatible with on-chain verification, and can be extended with off-chain Noir proofs.
- Game-hub integration: built to work with the Stellar Game Studio GameHub for session lifecycle and deterministic scoring.

Technical highlights

- Smart contract: Rust + Soroban contract implementing a 5-phase state machine (CommitHands → RevealHands → CommitChoice → RevealChoice → Complete).
- Commitments: `keccak256(left || right || salt)` and `keccak256(choice_index || salt)` ensure binding, with salt entropy kept off-chain until reveal.
- Frontend: TypeScript + React + Vite UI ("Arena" theme) with `ctmService` to handle bindings and transaction flow.
- Storage: temporary per-session state with TTL to avoid long-lived on-chain clutter.

How Zero-Knowledge works in CTM

- Commitments (lightweight ZK): CTM uses hash-based commit–reveal as its zero-knowledge primitive. Players compute a keccak256 preimage off-chain and submit only the 32-byte hash to the contract, keeping the preimage (choices + salt) secret until the reveal phase.

- Preimage formats:
	- Hands commitment: `preimage = left_hand_u8 || right_hand_u8 || salt_32bytes` → `keccak256(preimage)`.
	- Choice commitment: `preimage = choice_index_u8 || salt_32bytes` → `keccak256(preimage)`.

- On-chain verification: during the reveal phases the player supplies the original preimage elements (hands or choice index and salt). The contract recomputes the keccak256 hash and compares it to the stored commitment; mismatches are rejected (game state unchanged).

- Confidentiality & integrity: salts are required to be unpredictable and kept off-chain until reveal; this prevents a second party from brute-forcing the committed hands before reveal. The contract only learns the revealed values at the designated phase, preserving fairness.

- Optional off-chain ZK proofs: for stronger privacy or to prove preconditions (e.g., that two hands are different) without revealing hands, CTM can integrate Noir circuits that produce succinct proofs off-chain. The Noir proof can be submitted or verified off-chain to a trusted prover step prior to the reveal, while the contract retains the hash-based verification as the canonical check.

- Security notes: session IDs and temporary storage prevent replay across sessions; the contract enforces phase-ordering and rejects out-of-phase reveals. GameHub calls (`start_game` / `end_game`) provide lifecycle guarantees and keep scoring deterministic.

Quick demo & repo

- Repo: https://github.com/jamesbachini/Stellar-Game-Studio
- Run locally: `bun install && bun run setup && bun run dev:game ctm`

Where to read more (technical docs)

- Game Overview: `docs/ctm/README.md`
- Architecture: `docs/ctm/architecture.md`
- Rules & examples: `docs/ctm/game-rules.md`
- API + contract reference: `docs/ctm/api-reference.md`
- Development & deployment: `docs/ctm/development.md`

Judges notes (short)

CTM showcases how simple cryptographic commitments can add strategic depth to social games while remaining fully verifiable on-chain. It was implemented using Stellar Game Studio tooling (Soroban contracts, frontend scaffolding, and GameHub integration) to focus on gameplay and security rather than infra plumbing.

Contact / Run

- If you want a live walkthrough I can provide a short demo video or run the local dev frontend during judging. Reach me in the repo issues or the project contact listed in `package.json`.

— Stellar Game Studio / CTM team
