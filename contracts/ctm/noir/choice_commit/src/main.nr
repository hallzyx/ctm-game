// ============================================================================
// Gawi Bawi Bo ZK – Choice Commitment Circuit
// ============================================================================
//
// Proves that a player knows a valid hand-choice index whose keccak256
// hash matches the on-chain commitment, WITHOUT revealing which hand
// they decided to keep.
//
// Public input:  commitment    – the 32-byte keccak256 hash stored on chain
// Private inputs: choice_index, salt
//
// choice_index:  0 = keep left hand,  1 = keep right hand
//
// Preimage layout (33 bytes):
//   [choice_index(1)] [salt(32)]
//
// The same layout is used by the Soroban contract's hash_choice() function.
// ============================================================================

use std::hash::keccak256;

fn main(
    choice_index: u8,          // private – which hand to keep (0 or 1)
    salt:         [u8; 32],    // private – random 32-byte salt
    commitment:   pub [u8; 32] // public  – keccak256(choice_index || salt)
) {
    // ---- 1. Choice is valid (0 = left, 1 = right) ----
    assert(choice_index as u64 < 2, "choice_index must be 0 or 1");

    // ---- 2. Hash matches the on-chain commitment ----
    let mut preimage: [u8; 33] = [0; 33];
    preimage[0] = choice_index;
    for i in 0..32 {
        preimage[i + 1] = salt[i];
    }

    let computed: [u8; 32] = keccak256(preimage);
    assert(computed == commitment, "hash does not match commitment");
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_valid_choice_commitment() {
    let choice: u8 = 1; // keep right hand
    let salt: [u8; 32] = [99; 32];

    let mut preimage: [u8; 33] = [0; 33];
    preimage[0] = choice;
    for i in 0..32 {
        preimage[i + 1] = salt[i];
    }

    let hash: [u8; 32] = std::hash::keccak256(preimage);

    // Calling main should NOT panic
    main(choice, salt, hash);
}
