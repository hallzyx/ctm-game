#![cfg(test)]

//! Tests for the Gawi Bawi Bo ZK contract.
//!
//! Uses a minimal mock GameHub for isolation.

use crate::{CtmContract, CtmContractClient, Error};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

// ============================================================================
// Mock GameHub
// ============================================================================

#[contract]
pub struct MockGameHub;

#[contractimpl]
impl MockGameHub {
    pub fn start_game(
        _env: Env,
        _game_id: Address,
        _session_id: u32,
        _player1: Address,
        _player2: Address,
        _player1_points: i128,
        _player2_points: i128,
    ) {
    }
    pub fn end_game(_env: Env, _session_id: u32, _player1_won: bool) {}
    pub fn add_game(_env: Env, _game_address: Address) {}
}

// ============================================================================
// Helpers
// ============================================================================

fn setup_test() -> (
    Env,
    CtmContractClient<'static>,
    MockGameHubClient<'static>,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(soroban_sdk::testutils::LedgerInfo {
        timestamp: 1_441_065_600,
        protocol_version: 25,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: u32::MAX / 2,
        min_persistent_entry_ttl: u32::MAX / 2,
        max_entry_ttl: u32::MAX / 2,
    });

    let hub_addr = env.register(MockGameHub, ());
    let game_hub = MockGameHubClient::new(&env, &hub_addr);
    let admin = Address::generate(&env);
    let contract_id = env.register(CtmContract, (&admin, &hub_addr));
    let client = CtmContractClient::new(&env, &contract_id);
    game_hub.add_game(&contract_id);

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);

    (env, client, game_hub, player1, player2)
}

/// Compute keccak256(left || right || salt) matching the contract logic.
fn compute_hands_hash(env: &Env, left: u32, right: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.push_back(left as u8);
    pre.push_back(right as u8);
    pre.append(&Bytes::from_slice(env, &salt.to_array()));
    env.crypto().keccak256(&pre).into()
}

/// Compute keccak256(choice_index || salt) matching the contract logic.
fn compute_choice_hash(env: &Env, choice: u32, salt: &BytesN<32>) -> BytesN<32> {
    let mut pre = Bytes::new(env);
    pre.push_back(choice as u8);
    pre.append(&Bytes::from_slice(env, &salt.to_array()));
    env.crypto().keccak256(&pre).into()
}

/// Helper: assert a contract call returned a specific Error.
fn assert_ctm_error<T: core::fmt::Debug, E: core::fmt::Debug>(
    result: &Result<Result<T, E>, Result<Error, soroban_sdk::InvokeError>>,
    expected: Error,
) {
    match result {
        Err(Ok(actual)) => {
            assert_eq!(
                *actual, expected,
                "Expected {:?} but got {:?}",
                expected, actual
            );
        }
        other => panic!("Expected Err(Ok({:?})), got {:?}", expected, other),
    }
}

/// Fixed salt for deterministic tests.
fn test_salt(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[42u8; 32])
}

fn test_salt2(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[99u8; 32])
}

// ============================================================================
// Full-game flow helpers
// ============================================================================

/// Plays through Phase 1+2 (commit & reveal hands) for both players.
/// Returns (p1_left, p1_right, p2_left, p2_right).
fn play_hands(
    env: &Env,
    client: &CtmContractClient,
    session: u32,
    p1: &Address,
    p2: &Address,
    p1_left: u32,
    p1_right: u32,
    p2_left: u32,
    p2_right: u32,
) {
    let salt = test_salt(env);
    let h1 = compute_hands_hash(env, p1_left, p1_right, &salt);
    let h2 = compute_hands_hash(env, p2_left, p2_right, &salt);

    client.commit_hands(&session, p1, &h1);
    client.commit_hands(&session, p2, &h2);

    client.reveal_hands(&session, p1, &p1_left, &p1_right, &salt);
    client.reveal_hands(&session, p2, &p2_left, &p2_right, &salt);
}

/// Plays through Phase 3+4 (commit & reveal choice) for both players.
fn play_choices(
    env: &Env,
    client: &CtmContractClient,
    session: u32,
    p1: &Address,
    p2: &Address,
    p1_choice: u32,
    p2_choice: u32,
) {
    let salt = test_salt2(env);
    let c1 = compute_choice_hash(env, p1_choice, &salt);
    let c2 = compute_choice_hash(env, p2_choice, &salt);

    client.commit_choice(&session, p1, &c1);
    client.commit_choice(&session, p2, &c2);

    client.reveal_choice(&session, p1, &p1_choice, &salt);
    client.reveal_choice(&session, p2, &p2_choice, &salt);
}

// ============================================================================
// Tests
// ============================================================================

#[test]
fn test_complete_game_p1_wins() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 1u32;
    let pts = 100_0000000i128;

    client.start_game(&session, &p1, &p2, &pts, &pts);

    // P1: Rock(0) + Paper(1), P2: Scissors(2) + Paper(1)
    play_hands(&env, &client, session, &p1, &p2, 0, 1, 2, 1);

    let game = client.get_game(&session);
    assert_eq!(game.phase, 3); // Now in CommitChoice

    // P1 keeps left (Rock=0), P2 keeps left (Scissors=2)
    play_choices(&env, &client, session, &p1, &p2, 0, 0);

    let game = client.get_game(&session);
    assert_eq!(game.phase, 5);
    assert_eq!(game.p1_kept, Some(0)); // Rock
    assert_eq!(game.p2_kept, Some(2)); // Scissors
    assert_eq!(game.winner, Some(p1)); // Rock beats Scissors
}

#[test]
fn test_complete_game_p2_wins() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 2u32;
    let pts = 50_0000000i128;

    client.start_game(&session, &p1, &p2, &pts, &pts);

    // P1: Rock(0) + Scissors(2), P2: Paper(1) + Scissors(2)
    play_hands(&env, &client, session, &p1, &p2, 0, 2, 1, 2);

    // P1 keeps left (Rock=0), P2 keeps left (Paper=1)
    play_choices(&env, &client, session, &p1, &p2, 0, 0);

    let game = client.get_game(&session);
    assert_eq!(game.phase, 5);
    assert_eq!(game.p1_kept, Some(0)); // Rock
    assert_eq!(game.p2_kept, Some(1)); // Paper
    assert_eq!(game.winner, Some(p2)); // Paper beats Rock
}

#[test]
fn test_draw_p1_wins_tiebreak() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 3u32;
    let pts = 100_0000000i128;

    client.start_game(&session, &p1, &p2, &pts, &pts);

    // P1: Rock(0) + Paper(1), P2: Rock(0) + Scissors(2)
    play_hands(&env, &client, session, &p1, &p2, 0, 1, 0, 2);

    // Both keep left → Rock vs Rock = draw → P1 wins tiebreak
    play_choices(&env, &client, session, &p1, &p2, 0, 0);

    let game = client.get_game(&session);
    assert_eq!(game.phase, 5);
    assert_eq!(game.p1_kept, Some(0));
    assert_eq!(game.p2_kept, Some(0));
    assert_eq!(game.winner, Some(p1));
}

#[test]
fn test_keep_right_hand() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 4u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    // P1: Rock(0) + Scissors(2), P2: Paper(1) + Rock(0)
    play_hands(&env, &client, session, &p1, &p2, 0, 2, 1, 0);

    // P1 keeps right (Scissors=2), P2 keeps right (Rock=0) → Rock beats Scissors → P2 wins
    play_choices(&env, &client, session, &p1, &p2, 1, 1);

    let game = client.get_game(&session);
    assert_eq!(game.p1_kept, Some(2)); // Scissors
    assert_eq!(game.p2_kept, Some(0)); // Rock
    assert_eq!(game.winner, Some(p2));
}

#[test]
fn test_phase_enforcement_commit_before_start() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 10u32;

    // Game doesn't exist yet
    let salt = test_salt(&env);
    let h = compute_hands_hash(&env, 0, 1, &salt);
    let result = client.try_commit_hands(&session, &p1, &h);
    assert_ctm_error(&result, Error::GameNotFound);

    // Start game, phase = 1 (commit)
    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    // Can't reveal before commit phase is done
    let reveal_result = client.try_reveal_hands(&session, &p1, &0, &1, &salt);
    assert_ctm_error(&reveal_result, Error::WrongPhase);
}

#[test]
fn test_invalid_hands_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 11u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    let salt = test_salt(&env);

    // Commit with valid hash but reveal with invalid hand (3)
    // First create a hash for invalid hands
    let bad_hash = compute_hands_hash(&env, 3, 1, &salt);
    client.commit_hands(&session, &p1, &bad_hash);

    // P2 commits normally so we advance to phase 2
    let h2 = compute_hands_hash(&env, 0, 1, &salt);
    client.commit_hands(&session, &p2, &h2);

    // Now try to reveal with invalid hand
    let result = client.try_reveal_hands(&session, &p1, &3, &1, &salt);
    assert_ctm_error(&result, Error::InvalidHand);
}

#[test]
fn test_same_hands_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 12u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    let salt = test_salt(&env);

    // Commit with same-hands hash
    let same_hash = compute_hands_hash(&env, 1, 1, &salt);
    client.commit_hands(&session, &p1, &same_hash);
    let h2 = compute_hands_hash(&env, 0, 2, &salt);
    client.commit_hands(&session, &p2, &h2);

    // Reveal same hands
    let result = client.try_reveal_hands(&session, &p1, &1, &1, &salt);
    assert_ctm_error(&result, Error::HandsMustDiffer);
}

#[test]
fn test_hash_mismatch_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 13u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    let salt = test_salt(&env);
    let h1 = compute_hands_hash(&env, 0, 1, &salt);
    let h2 = compute_hands_hash(&env, 1, 2, &salt);

    client.commit_hands(&session, &p1, &h1);
    client.commit_hands(&session, &p2, &h2);

    // P1 tries to reveal different hands than committed (cheating!)
    let result = client.try_reveal_hands(&session, &p1, &1, &2, &salt);
    assert_ctm_error(&result, Error::HashMismatch);
}

#[test]
fn test_double_commit_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 14u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    let salt = test_salt(&env);
    let h1 = compute_hands_hash(&env, 0, 1, &salt);

    client.commit_hands(&session, &p1, &h1);

    // Double commit
    let result = client.try_commit_hands(&session, &p1, &h1);
    assert_ctm_error(&result, Error::AlreadyCommitted);
}

#[test]
fn test_not_player_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 15u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

    let outsider = Address::generate(&env);
    let salt = test_salt(&env);
    let h = compute_hands_hash(&env, 0, 1, &salt);

    let result = client.try_commit_hands(&session, &outsider, &h);
    assert_ctm_error(&result, Error::NotPlayer);
}

#[test]
fn test_invalid_choice_rejected() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 16u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);
    play_hands(&env, &client, session, &p1, &p2, 0, 1, 1, 2);

    // Phase 3 – try choice_index = 2 (invalid, must be 0 or 1)
    let salt = test_salt2(&env);
    let bad_hash = compute_choice_hash(&env, 2, &salt);
    client.commit_choice(&session, &p1, &bad_hash);
    let c2 = compute_choice_hash(&env, 0, &salt);
    client.commit_choice(&session, &p2, &c2);

    let result = client.try_reveal_choice(&session, &p1, &2, &salt);
    assert_ctm_error(&result, Error::InvalidChoice);
}

#[test]
fn test_all_rps_outcomes() {
    // Rock(0) vs Paper(1) → P2 wins
    // Rock(0) vs Scissors(2) → P1 wins
    // Paper(1) vs Rock(0) → P1 wins
    // Paper(1) vs Scissors(2) → P2 wins
    // Scissors(2) vs Rock(0) → P2 wins
    // Scissors(2) vs Paper(1) → P1 wins

    let matchups: [(u32, u32, bool); 6] = [
        (0, 1, false), // Rock vs Paper → P2
        (0, 2, true),  // Rock vs Scissors → P1
        (1, 0, true),  // Paper vs Rock → P1
        (1, 2, false), // Paper vs Scissors → P2
        (2, 0, false), // Scissors vs Rock → P2
        (2, 1, true),  // Scissors vs Paper → P1
    ];

    for (i, (h1, h2, p1_wins)) in matchups.iter().enumerate() {
        let (env, client, _hub, p1, p2) = setup_test();
        let session = 100 + i as u32;

        client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);

        // P1 needs hands containing h1, P2 needs hands containing h2
        // Each player picks the target hand as left and a different hand as right
        let p1_right = (*h1 + 1) % 3;
        let p2_right = (*h2 + 1) % 3;

        play_hands(&env, &client, session, &p1, &p2, *h1, p1_right, *h2, p2_right);

        // Both keep left (index 0) → keeps h1 and h2
        play_choices(&env, &client, session, &p1, &p2, 0, 0);

        let game = client.get_game(&session);
        let expected_winner = if *p1_wins { p1.clone() } else { p2.clone() };
        assert_eq!(
            game.winner,
            Some(expected_winner),
            "Matchup {}: hand {} vs {} failed",
            i,
            h1,
            h2
        );
    }
}

#[test]
fn test_phase_transitions() {
    let (env, client, _hub, p1, p2) = setup_test();
    let session = 200u32;

    client.start_game(&session, &p1, &p2, &100_0000000, &100_0000000);
    assert_eq!(client.get_game(&session).phase, 1);

    let salt = test_salt(&env);
    let h1 = compute_hands_hash(&env, 0, 1, &salt);
    let h2 = compute_hands_hash(&env, 1, 2, &salt);

    // One commit → still phase 1
    client.commit_hands(&session, &p1, &h1);
    assert_eq!(client.get_game(&session).phase, 1);

    // Both commit → phase 2
    client.commit_hands(&session, &p2, &h2);
    assert_eq!(client.get_game(&session).phase, 2);

    // One reveal → still phase 2
    client.reveal_hands(&session, &p1, &0, &1, &salt);
    assert_eq!(client.get_game(&session).phase, 2);

    // Both reveal → phase 3
    client.reveal_hands(&session, &p2, &1, &2, &salt);
    assert_eq!(client.get_game(&session).phase, 3);

    let salt2 = test_salt2(&env);
    let c1 = compute_choice_hash(&env, 0, &salt2);
    let c2 = compute_choice_hash(&env, 1, &salt2);

    // One choice commit → still phase 3
    client.commit_choice(&session, &p1, &c1);
    assert_eq!(client.get_game(&session).phase, 3);

    // Both choice commit → phase 4
    client.commit_choice(&session, &p2, &c2);
    assert_eq!(client.get_game(&session).phase, 4);

    // One reveal choice → still phase 4
    client.reveal_choice(&session, &p1, &0, &salt2);
    assert_eq!(client.get_game(&session).phase, 4);

    // Both reveal → phase 5 (complete)
    client.reveal_choice(&session, &p2, &1, &salt2);
    assert_eq!(client.get_game(&session).phase, 5);
}
