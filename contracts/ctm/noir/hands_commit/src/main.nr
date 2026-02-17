// ============================================================================
// Gawi Bawi Bo ZK – Hands Commitment Circuit
// ============================================================================
//
// Proves that a player knows two valid, different RPS hands whose
// keccak256 hash matches the on-chain commitment, WITHOUT revealing
// which hands they chose.
//
// Public input:  commitment  – the 32-byte keccak256 hash stored on chain
// Private inputs: left_hand, right_hand, salt
//
// Hand encoding:  0 = Rock 🪨,  1 = Paper ✋,  2 = Scissors ✌️
//
// Preimage layout (34 bytes):
//   [left_hand(1)] [right_hand(1)] [salt(32)]
//
// The same layout is used by the Soroban contract's hash_hands() function.
// ============================================================================

use std::hash::keccak256;

fn main(
    left_hand:  u8,          // private – the left hand figure (0-2)
    right_hand: u8,          // private – the right hand figure (0-2)
    salt:       [u8; 32],    // private – random 32-byte salt
    commitment: pub [u8; 32] // public  – keccak256(left || right || salt)
) {
    // ---- 1. Hands are valid RPS figures ----
    assert(left_hand as u64 < 3, "left_hand must be 0, 1, or 2");
    assert(right_hand as u64 < 3, "right_hand must be 0, 1, or 2");

    // ---- 2. Hands are different (game rule) ----
    assert(left_hand != right_hand, "hands must be different figures");

    // ---- 3. Hash matches the on-chain commitment ----
    let mut preimage: [u8; 34] = [0; 34];
    preimage[0] = left_hand;
    preimage[1] = right_hand;
    for i in 0..32 {
        preimage[i + 2] = salt[i];
    }

    let computed: [u8; 32] = keccak256(preimage);
    assert(computed == commitment, "hash does not match commitment");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_valid_commitment() {
    // This is a basic sanity test.
    // Real proofs are generated with `nargo prove` using Prover.toml inputs.
    let left: u8 = 0;   // Rock
    let right: u8 = 2;  // Scissors
    let salt: [u8; 32] = [42; 32];

    let mut preimage: [u8; 34] = [0; 34];
    preimage[0] = left;
    preimage[1] = right;
    for i in 0..32 {
        preimage[i + 2] = salt[i];
    }

    let hash: [u8; 32] = std::hash::keccak256(preimage);

    // Calling main should NOT panic
    main(left, right, salt, hash);
}
