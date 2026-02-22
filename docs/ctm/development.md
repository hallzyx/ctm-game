# CTM Development Guide

## Prerequisites

### System Requirements
- **Rust**: 1.70+ with wasm32 target
- **Soroban CLI**: Latest version
- **Node.js**: 18+ with npm/bun
- **Stellar Account**: Testnet funds for deployment

### Installation
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install soroban-cli

# Install Node.js dependencies
bun install
```

## Project Structure

## Noir circuits and prover workflow (integrated feature)

CTM ships with support for Noir circuits and a recommended, production-ready prover workflow. Noir is treated as an integrated feature in CTM and is used by the frontend and tournament tooling to produce privacy-preserving attestations and enforce richer invariants.

### Goals for circuits
- Prove that both committed hands are valid and different without revealing them.
- Prove that a committed choice matches one of the previously revealed hands (privacy-preserving consistency check).

### Suggested workflow (CTM standard)
1. **Write circuits**: implement a Noir circuit that accepts private inputs (left, right, salts, choice_index) and exposes public inputs (commitment hash, session id). The circuit asserts validity and either recomputes the commitment hash or checks intermediate hashes depending on your proving backend.
2. **Compile**: build the circuit with the Noir toolchain to produce prover artifacts and optional verifier artifacts.
3. **Prove**: the frontend or a trusted prover service runs the prover to generate proofs when a player commits or before reveals.
4. **Publish proof**: store proof and public inputs in a prover API or IPFS; include a short reference (CID or signed attestation) in the transaction memo or the game scoreboard tied to `session_id`.
5. **Verify**: tournament backends or auditors fetch the proof and verify it off-chain. CTM provides helper scripts to run verification during CI.

### Example (high-level commands)
- Create circuit: `noir new ctms_circuit`
- Build circuit: `noir build`
- Generate proof: `noir prove --private inputs.json --public public.json --out proof.bin`
- Verify (off-chain): `noir verify --proof proof.bin --public public.json`

Note: CLI names vary with Noir versions; consult Noir docs for exact commands. CTM includes example circuits and a proof runner in `scripts/noir/` (see repo examples) to bootstrap integration.

### Integration notes
- The on-chain contract remains the authoritative guardrail via keccak256 checks; Noir proofs augment privacy and provide auditable assertions for tournament flows.
- For tournament integrations, run a dedicated verifier service that validates proofs and issues signed attestations; the frontend attaches these attestations to transactions to streamline verification.

### Tests and CI
- Add unit tests for circuit logic and CI steps that generate and verify proofs as part of the test matrix.
- Store canonical test vectors to detect regressions in circuit or prover changes.
cargo test

# Integration tests with Soroban
soroban contract invoke \
  --id CDM2VXXHUAUTC5SKU2GZ5CSQJBAUPC4BOJHJTI2M4XP3CWYGBBEQLJUQ \
  --source SA... \
  --network testnet \
  -- get_game \
  --session_id 123
```

#### Deploying Contract
```bash
# Build optimized wasm
soroban contract build --release

# Deploy to testnet
soroban contract deploy \
  --source SA... \
  --network testnet \
  --wasm target/wasm32-unknown-unknown/release/ctm_contract.wasm
```

### 2. Frontend Development

#### Running Development Server
```bash
cd ctm-frontend
bun run dev
```

#### Building for Production
```bash
bun run build
```

#### Generating Contract Bindings
```bash
# After contract deployment, generate TypeScript bindings
soroban contract bindings typescript \
  --contract-id CDM2VXXHUAUTC5SKU2GZ5CSQJBAUPC4BOJHJTI2M4XP3CWYGBBEQLJUQ \
  --network testnet \
  --output-dir src/games/ctm
```

### 3. Full Stack Development

#### Using the Scaffold Script
```bash
# Setup complete environment
bun run setup

# Create CTM game instance
bun run create ctm

# Run development environment
bun run dev:game ctm
```

## Testing Strategy

### Contract Testing

#### Unit Tests
```rust
#[test]
fn test_hash_hands() {
    let env = Env::default();
    let left = 0u32;  // Rock
    let right = 1u32; // Paper
    let salt = BytesN::from_array(&env, &[1; 32]);

    let hash = hash_hands(&env, left, right, &salt);
    assert!(hash.len() == 32);
}
```

#### Integration Tests
```rust
#[test]
fn test_full_game_flow() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CtmContract);

    // Test complete game from start to finish
    // ... test implementation
}
```

### Frontend Testing

#### Component Tests
```typescript
import { render, screen } from '@testing-library/react';
import { CtmGame } from './CtmGame';

test('renders game title', () => {
  render(<CtmGame />);
  expect(screen.getByText('Commit · Turn · Move')).toBeInTheDocument();
});
```

#### Service Tests
```typescript
import { CtmService } from './ctmService';

test('computes hands hash correctly', () => {
  const service = new CtmService('test-id');
  const salt = new Uint8Array(32);
  const hash = service.computeHandsHash(0, 1, salt);
  expect(hash).toBeDefined();
});
```

### End-to-End Testing

#### Manual Testing Checklist
- [ ] Game creation flow works
- [ ] Hand commitment succeeds
- [ ] Hand revelation verifies correctly
- [ ] Choice commitment works
- [ ] Choice revelation resolves game
- [ ] Winner determination is correct
- [ ] Error states handled gracefully

#### Automated E2E Tests
```typescript
// Using Playwright or similar
test('complete game flow', async ({ page }) => {
  await page.goto('/ctm');
  // ... complete game automation
});
```

## Debugging

### Contract Debugging

#### Logging Contract State
```rust
env.logs().add("Game phase", game.phase);
```

#### Inspecting Transactions
```bash
# Get transaction details
soroban transaction get --id <tx-id> --network testnet
```

### Frontend Debugging

#### Contract Interaction Logs
```typescript
console.log('Contract response:', result);
```

#### Network Request Monitoring
- Use browser dev tools network tab
- Check Stellar Laboratory for transaction status

### Common Issues

#### Contract Deployment
- **Issue**: WASM file too large
- **Solution**: Optimize build with `--release` flag

#### Frontend Connection
- **Issue**: Contract not found
- **Solution**: Verify contract ID and network configuration

#### Transaction Failures
- **Issue**: Insufficient funds
- **Solution**: Fund testnet account with XLM

## Performance Optimization

### Contract Optimization
- Minimize storage operations
- Use efficient data structures
- Batch related operations

### Frontend Optimization
- Implement code splitting
- Use React.memo for components
- Optimize re-renders

### Network Optimization
- Cache contract state locally
- Use efficient polling strategies
- Batch multiple contract calls

## Security Considerations

### Contract Security
- Validate all inputs
- Use safe math operations
- Implement proper access controls
- Test for reentrancy attacks

### Frontend Security
- Sanitize user inputs
- Use secure random generation
- Implement proper error handling
- Avoid storing sensitive data

## Deployment Checklist

### Pre-deployment
- [ ] All tests pass
- [ ] Contract audited (recommended)
- [ ] Frontend builds successfully
- [ ] Environment variables configured
- [ ] Network configuration correct

### Deployment Steps
1. Deploy contract to testnet
2. Generate production bindings
3. Build optimized frontend
4. Configure production environment
5. Deploy frontend to hosting service
6. Update DNS and monitoring

### Post-deployment
- [ ] Verify contract functionality
- [ ] Test user flows
- [ ] Monitor error rates
- [ ] Setup alerting

## Contributing

### Code Style
- Follow Rust formatting with `cargo fmt`
- Use TypeScript strict mode
- Follow conventional commit messages

### Pull Request Process
1. Create feature branch
2. Implement changes with tests
3. Update documentation
4. Submit PR with description
5. Code review and approval
6. Merge to main

### Issue Reporting
- Use GitHub issues for bugs
- Include reproduction steps
- Provide environment details
- Attach relevant logs

## Resources

### Documentation
- [Soroban Documentation](https://soroban.stellar.org/)
- [Stellar Developer Docs](https://developers.stellar.org/)
- [Rust Documentation](https://doc.rust-lang.org/)

### Tools
- [Stellar Laboratory](https://laboratory.stellar.org/)
- [Soroban CLI](https://soroban.stellar.org/docs/reference/cli)
- [Stellar Expert](https://stellar.expert/)

### Community
- [Stellar Discord](https://discord.gg/stellar)
- [Soroban GitHub](https://github.com/stellar/soroban)
- [Stellar Stack Exchange](https://stellar.stackexchange.com/)