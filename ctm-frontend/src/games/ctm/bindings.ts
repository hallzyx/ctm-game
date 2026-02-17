import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDM2VXXHUAUTC5SKU2GZ5CSQJBAUPC4BOJHJTI2M4XP3CWYGBBEQLJUQ",
  }
} as const

export const Errors = {
  1: {message:"GameNotFound"},
  2: {message:"NotPlayer"},
  3: {message:"WrongPhase"},
  4: {message:"AlreadyCommitted"},
  5: {message:"InvalidHand"},
  6: {message:"HandsMustDiffer"},
  7: {message:"HashMismatch"},
  8: {message:"InvalidChoice"},
  9: {message:"GameAlreadyEnded"}
}


/**
 * Hand constants: 0 = Rock 🪨,  1 = Paper ✋,  2 = Scissors ✌️
 * 
 * Game phases:
 * 1 = CommitHands      – waiting for both commit hashes
 * 2 = RevealHands      – waiting for both to reveal hands
 * 3 = CommitChoice     – waiting for both to commit which hand to keep
 * 4 = RevealChoice     – waiting for both to reveal their choice
 * 5 = Complete         – winner determined
 */
export interface Game {
  p1_choice_commit: Option<Buffer>;
  p1_commit: Option<Buffer>;
  p1_kept: Option<u32>;
  p1_left: Option<u32>;
  p1_right: Option<u32>;
  p2_choice_commit: Option<Buffer>;
  p2_commit: Option<Buffer>;
  p2_kept: Option<u32>;
  p2_left: Option<u32>;
  p2_right: Option<u32>;
  phase: u32;
  player1: string;
  player1_points: i128;
  player2: string;
  player2_points: i128;
  winner: Option<string>;
}

export type DataKey = {tag: "Game", values: readonly [u32]} | {tag: "GameHubAddress", values: void} | {tag: "Admin", values: void};

export interface Client {
  /**
   * Construct and simulate a start_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Start a new Gawi Bawi Bo session.
   * 
   * Creates a session in the Game Hub and locks both players' points.
   * Requires multi-sig auth from both players.
   */
  start_game: ({session_id, player1, player2, player1_points, player2_points}: {session_id: u32, player1: string, player2: string, player1_points: i128, player2_points: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_hands transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * **Phase 1** – Commit two hands (hidden).
   * 
   * `hands_hash = keccak256(left_hand_u8 || right_hand_u8 || salt_32bytes)`
   */
  commit_hands: ({session_id, player, hands_hash}: {session_id: u32, player: string, hands_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_hands transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * **Phase 2** – Reveal hands and verify against the commitment hash.
   * 
   * The contract recomputes `keccak256(left || right || salt)` and checks
   * it matches the stored commitment.  Both hands must be valid (0-2) and
   * different from each other.
   */
  reveal_hands: ({session_id, player, left_hand, right_hand, salt}: {session_id: u32, player: string, left_hand: u32, right_hand: u32, salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a commit_choice transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * **Phase 3** – Commit which hand to keep (hidden).
   * 
   * `choice_hash = keccak256(choice_index_u8 || salt_32bytes)`
   * where `choice_index` is 0 for the left hand, 1 for the right.
   */
  commit_choice: ({session_id, player, choice_hash}: {session_id: u32, player: string, choice_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a reveal_choice transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * **Phase 4** – Reveal which hand you kept.
   * 
   * The contract verifies the hash, looks up the actual hand value, and —
   * once both players have revealed — resolves the RPS duel and reports to
   * the Game Hub.
   */
  reveal_choice: ({session_id, player, choice_index, salt}: {session_id: u32, player: string, choice_index: u32, salt: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_game transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Read the current game state.
   */
  get_game: ({session_id}: {session_id: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Game>>>

  /**
   * Construct and simulate a get_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_admin: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_hub: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_hub transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_hub: ({new_hub}: {new_hub: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, game_hub}: {admin: string, game_hub: string},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, game_hub}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAMR2FtZU5vdEZvdW5kAAAAAQAAAAAAAAAJTm90UGxheWVyAAAAAAAAAgAAAAAAAAAKV3JvbmdQaGFzZQAAAAAAAwAAAAAAAAAQQWxyZWFkeUNvbW1pdHRlZAAAAAQAAAAAAAAAC0ludmFsaWRIYW5kAAAAAAUAAAAAAAAAD0hhbmRzTXVzdERpZmZlcgAAAAAGAAAAAAAAAAxIYXNoTWlzbWF0Y2gAAAAHAAAAAAAAAA1JbnZhbGlkQ2hvaWNlAAAAAAAACAAAAAAAAAAQR2FtZUFscmVhZHlFbmRlZAAAAAk=",
        "AAAAAQAAAXZIYW5kIGNvbnN0YW50czogMCA9IFJvY2sg8J+qqCwgIDEgPSBQYXBlciDinIssICAyID0gU2Npc3NvcnMg4pyM77iPCgpHYW1lIHBoYXNlczoKMSA9IENvbW1pdEhhbmRzICAgICAg4oCTIHdhaXRpbmcgZm9yIGJvdGggY29tbWl0IGhhc2hlcwoyID0gUmV2ZWFsSGFuZHMgICAgICDigJMgd2FpdGluZyBmb3IgYm90aCB0byByZXZlYWwgaGFuZHMKMyA9IENvbW1pdENob2ljZSAgICAg4oCTIHdhaXRpbmcgZm9yIGJvdGggdG8gY29tbWl0IHdoaWNoIGhhbmQgdG8ga2VlcAo0ID0gUmV2ZWFsQ2hvaWNlICAgICDigJMgd2FpdGluZyBmb3IgYm90aCB0byByZXZlYWwgdGhlaXIgY2hvaWNlCjUgPSBDb21wbGV0ZSAgICAgICAgIOKAkyB3aW5uZXIgZGV0ZXJtaW5lZAAAAAAAAAAAAARHYW1lAAAAEAAAAAAAAAAQcDFfY2hvaWNlX2NvbW1pdAAAA+gAAAPuAAAAIAAAAAAAAAAJcDFfY29tbWl0AAAAAAAD6AAAA+4AAAAgAAAAAAAAAAdwMV9rZXB0AAAAA+gAAAAEAAAAAAAAAAdwMV9sZWZ0AAAAA+gAAAAEAAAAAAAAAAhwMV9yaWdodAAAA+gAAAAEAAAAAAAAABBwMl9jaG9pY2VfY29tbWl0AAAD6AAAA+4AAAAgAAAAAAAAAAlwMl9jb21taXQAAAAAAAPoAAAD7gAAACAAAAAAAAAAB3AyX2tlcHQAAAAD6AAAAAQAAAAAAAAAB3AyX2xlZnQAAAAD6AAAAAQAAAAAAAAACHAyX3JpZ2h0AAAD6AAAAAQAAAAAAAAABXBoYXNlAAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAA5wbGF5ZXIxX3BvaW50cwAAAAAACwAAAAAAAAAHcGxheWVyMgAAAAATAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEw==",
        "AAAAAgAAAAAAAAAAAAAAB0RhdGFLZXkAAAAAAwAAAAEAAAAAAAAABEdhbWUAAAABAAAABAAAAAAAAAAAAAAADkdhbWVIdWJBZGRyZXNzAAAAAAAAAAAAAAAAAAVBZG1pbgAAAA==",
        "AAAAAAAAADZJbml0aWFsaXplIHRoZSBjb250cmFjdCB3aXRoIGFkbWluICsgR2FtZSBIdWIgYWRkcmVzcy4AAAAAAA1fX2NvbnN0cnVjdG9yAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAhnYW1lX2h1YgAAABMAAAAA",
        "AAAAAAAAAI9TdGFydCBhIG5ldyBHYXdpIEJhd2kgQm8gc2Vzc2lvbi4KCkNyZWF0ZXMgYSBzZXNzaW9uIGluIHRoZSBHYW1lIEh1YiBhbmQgbG9ja3MgYm90aCBwbGF5ZXJzJyBwb2ludHMuClJlcXVpcmVzIG11bHRpLXNpZyBhdXRoIGZyb20gYm90aCBwbGF5ZXJzLgAAAAAKc3RhcnRfZ2FtZQAAAAAABQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAHcGxheWVyMQAAAAATAAAAAAAAAAdwbGF5ZXIyAAAAABMAAAAAAAAADnBsYXllcjFfcG9pbnRzAAAAAAALAAAAAAAAAA5wbGF5ZXIyX3BvaW50cwAAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAHMqKlBoYXNlIDEqKiDigJMgQ29tbWl0IHR3byBoYW5kcyAoaGlkZGVuKS4KCmBoYW5kc19oYXNoID0ga2VjY2FrMjU2KGxlZnRfaGFuZF91OCB8fCByaWdodF9oYW5kX3U4IHx8IHNhbHRfMzJieXRlcylgAAAAAAxjb21taXRfaGFuZHMAAAADAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACmhhbmRzX2hhc2gAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAOwqKlBoYXNlIDIqKiDigJMgUmV2ZWFsIGhhbmRzIGFuZCB2ZXJpZnkgYWdhaW5zdCB0aGUgY29tbWl0bWVudCBoYXNoLgoKVGhlIGNvbnRyYWN0IHJlY29tcHV0ZXMgYGtlY2NhazI1NihsZWZ0IHx8IHJpZ2h0IHx8IHNhbHQpYCBhbmQgY2hlY2tzCml0IG1hdGNoZXMgdGhlIHN0b3JlZCBjb21taXRtZW50LiAgQm90aCBoYW5kcyBtdXN0IGJlIHZhbGlkICgwLTIpIGFuZApkaWZmZXJlbnQgZnJvbSBlYWNoIG90aGVyLgAAAAxyZXZlYWxfaGFuZHMAAAAFAAAAAAAAAApzZXNzaW9uX2lkAAAAAAAEAAAAAAAAAAZwbGF5ZXIAAAAAABMAAAAAAAAACWxlZnRfaGFuZAAAAAAAAAQAAAAAAAAACnJpZ2h0X2hhbmQAAAAAAAQAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAK0qKlBoYXNlIDMqKiDigJMgQ29tbWl0IHdoaWNoIGhhbmQgdG8ga2VlcCAoaGlkZGVuKS4KCmBjaG9pY2VfaGFzaCA9IGtlY2NhazI1NihjaG9pY2VfaW5kZXhfdTggfHwgc2FsdF8zMmJ5dGVzKWAKd2hlcmUgYGNob2ljZV9pbmRleGAgaXMgMCBmb3IgdGhlIGxlZnQgaGFuZCwgMSBmb3IgdGhlIHJpZ2h0LgAAAAAAAA1jb21taXRfY2hvaWNlAAAAAAAAAwAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAAAAAAGcGxheWVyAAAAAAATAAAAAAAAAAtjaG9pY2VfaGFzaAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAMsqKlBoYXNlIDQqKiDigJMgUmV2ZWFsIHdoaWNoIGhhbmQgeW91IGtlcHQuCgpUaGUgY29udHJhY3QgdmVyaWZpZXMgdGhlIGhhc2gsIGxvb2tzIHVwIHRoZSBhY3R1YWwgaGFuZCB2YWx1ZSwgYW5kIOKAlApvbmNlIGJvdGggcGxheWVycyBoYXZlIHJldmVhbGVkIOKAlCByZXNvbHZlcyB0aGUgUlBTIGR1ZWwgYW5kIHJlcG9ydHMgdG8KdGhlIEdhbWUgSHViLgAAAAANcmV2ZWFsX2Nob2ljZQAAAAAAAAQAAAAAAAAACnNlc3Npb25faWQAAAAAAAQAAAAAAAAABnBsYXllcgAAAAAAEwAAAAAAAAAMY2hvaWNlX2luZGV4AAAABAAAAAAAAAAEc2FsdAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAABxSZWFkIHRoZSBjdXJyZW50IGdhbWUgc3RhdGUuAAAACGdldF9nYW1lAAAAAQAAAAAAAAAKc2Vzc2lvbl9pZAAAAAAABAAAAAEAAAPpAAAH0AAAAARHYW1lAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAJc2V0X2FkbWluAAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAHZ2V0X2h1YgAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAAAAAAAHc2V0X2h1YgAAAAABAAAAAAAAAAduZXdfaHViAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA" ]),
      options
    )
  }
  public readonly fromJSON = {
    start_game: this.txFromJSON<Result<void>>,
        commit_hands: this.txFromJSON<Result<void>>,
        reveal_hands: this.txFromJSON<Result<void>>,
        commit_choice: this.txFromJSON<Result<void>>,
        reveal_choice: this.txFromJSON<Result<void>>,
        get_game: this.txFromJSON<Result<Game>>,
        get_admin: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        get_hub: this.txFromJSON<string>,
        set_hub: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>
  }
}