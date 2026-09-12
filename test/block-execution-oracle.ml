open Oracle_bytes
let ( let* ) = Result.bind
module Address = Tn_types.Units.Address
let word raw = let* bytes = unhex raw in Option.to_result ~none:"word" (U256.of_be_bytes bytes)
let address raw = let* bytes = unhex raw in Option.to_result ~none:"address" (Address.of_bytes bytes)
let integer raw = Option.to_result ~none:"int" (int_of_string_opt raw)
let nonce raw = let* value = word raw in Option.to_result ~none:"nonce" (Option.bind (U256.to_int value) Nonce.of_int)
let spec = function "0" -> Spec.Shanghai | "1" -> Spec.Cancun | _ -> Spec.Prague
let word_hex value = hex (U256.to_be_bytes value)
let storage_text slots = String.concat "" (List.map (fun (key, value) -> word_hex key ^ "=" ^ word_hex value ^ ",") slots)
let world_text world = World_state.accounts world |> List.map (fun (address, account) ->
  String.concat ":" [hex (Address.to_bytes address); Nonce.to_string (Account.nonce account); word_hex (Account.balance account);
    hex (Account.code account); storage_text (Storage.bindings (Account.storage account))] ^ ";") |> String.concat ""
let parse_world raw =
  if String.equal raw "deploy" then Ok (System_contracts.predeploy World_state.empty) else
  let entries = if String.equal raw "-" then [] else String.split_on_char ',' raw in
  List.fold_left (fun result entry ->
    let* world = result in
    match String.split_on_char ':' entry with
    | [addr; n; balance; code; slot] ->
        let* addr = address addr in let* nonce = nonce n in let* balance = word balance in
        let* code = unhex code in let* slot = word slot in
        let account = Account.make ~nonce ~balance |> fun a -> Account.with_code a code |> fun a -> Account.set_slot a U256.zero slot in
        Ok (World_state.set_account world addr account)
    | [] | _ :: _ -> Error "account") (Ok World_state.empty) entries
let parse_block raw = match String.split_on_char ':' raw with
  | [fork; coinbase; basefee_address; chain; gas_limit; basefee; number; timestamp; blob] ->
      let* coinbase = address coinbase in let* basefee_address = address basefee_address in
      let* chain_id = word chain in let* gas_limit = word gas_limit in let* basefee = word basefee in
      let* number = word number in let* timestamp = word timestamp in let* blob_gasprice = word blob in
      let prevrandao = Option.value ~default:U256.zero (U256.of_int 17) in
      Ok (Env.Block.make_at_spec ~spec:(spec fork) ~coinbase ~timestamp ~number ~prevrandao
        ~gas_limit ~basefee ~basefee_address ~chain_id ~blob_gasprice ~hashes:Block_hashes.empty)
  | [] | _ :: _ -> Error "block"
let parse_context block raw = match String.split_on_char ':' raw with
  | [parent; root; position; extra; count] ->
      let* parent = unhex parent in let* parent_hash = Option.to_result ~none:"parent" (Tn_keccak.of_stored_bytes parent) in
      let* root = unhex root in let* root = Option.to_result ~none:"root" (Tn_crypto.Digest.of_bytes root) in
      let* position = word position in let* extra = unhex extra in let* count = integer count in
      let withdrawal_address = Address_word.of_word U256.one in
      let withdrawals = List.init count (fun index -> Withdrawal.make ~index ~validator_index:0 ~address:withdrawal_address ~amount:2) |> List.filter_map Fun.id in
      let* boundary = Epoch_boundary.of_extra_data extra ~withdrawals |> Result.map_error Epoch_boundary.error_to_string in
      let* batch = Option.to_result ~none:"batch" (Tn_crypto.Digest.of_bytes (U256.to_be_bytes (Option.value ~default:U256.zero (U256.of_int 19)))) in
      Block_context.make ~block ~parent_hash ~consensus_root:(Digests.Output_digest.of_digest root)
        ~nonce:(Units.Sequence_number.of_epoch_round Units.Epoch.zero Round.genesis) ~batch_digest:(Digests.Batch_digest.of_digest batch)
        ~position:(Batch_position.of_word position) ~boundary |> Result.map_error Block_context.error_to_string
  | [] | _ :: _ -> Error "context"
let root_text = function
  | Block_execution.Pre_block.Root_skipped_after_first_batch -> "batch"
  | Block_execution.Pre_block.Root_skipped_before_cancun -> "fork"
  | Block_execution.Pre_block.Root_skipped_at_genesis -> "genesis"
  | Block_execution.Pre_block.Root_written outcome -> "written:" ^ Receipt.to_string (System_call.receipt outcome)
let hashes_text = function
  | Block_execution.Pre_block.Hash_skipped_before_prague -> "fork"
  | Block_execution.Pre_block.Hash_skipped_at_genesis -> "genesis"
  | Block_execution.Pre_block.Hash_written outcome -> "written:" ^ Receipt.to_string (System_call.receipt outcome)
let pre_text pre = root_text (Block_execution.Pre_block.consensus_root pre) ^ ":" ^ hashes_text (Block_execution.Pre_block.blockhashes pre)
let csv raw = if String.equal raw "-" then [] else String.split_on_char ',' raw
let rec parse_list parse = function
  | [] -> Ok []
  | head :: tail -> let* value = parse head in let* rest = parse_list parse tail in Ok (value :: rest)
let envelope raw = let* bytes = unhex raw in Tx_envelope.decode_2718 bytes |> Result.map_error Tx_envelope.error_to_string
let reward raw = match String.split_on_char ':' raw with
  | [addr; n] -> let* addr = address addr in let* n = integer n in Ok (addr, n)
  | [] | _ :: _ -> Error "reward"
let complete pre context outcome invalid =
  let* finished = Block_execution.finish outcome ~context |> Result.map_error Block_execution.error_to_string in
  let* header = Block_header.assemble ~context ~finished |> Result.map_error Block_header.error_to_string in
  Ok (String.concat "|" [pre_text pre; world_text (Block_execution.Finished.world finished);
    String.concat "" (List.map (fun env -> hex (Tx_envelope.encode_2718 env) ^ ",") (Block_execution.transactions outcome));
    String.concat "" (List.map (fun (ty, receipt) -> string_of_int ty ^ ":" ^ Receipt.to_string receipt ^ ";") (Block_execution.receipts outcome));
    string_of_int (Block_execution.gas_used outcome); hex (Bloom.to_bytes (Block_execution.logs_bloom outcome));
    hex (Block_header.encode_rlp header); Tn_keccak.to_hex (Block_header.hash header);
    String.concat "" (List.map (fun bad -> Block_execution.Invalid_tx.to_string bad ^ ";") invalid)])
let dispatch line = match String.split_on_char ' ' line with
  | ["signing-hash"; input] ->
      let* env = envelope input in Ok (hex (Tx_envelope.signature_hash (Tx_envelope.payload env)))
  | ["selectors"] -> Ok (String.concat "," (List.map hex [Registry_abi.apply_incentives_selector; Registry_abi.get_validators_selector;
      Registry_abi.get_next_committee_size_selector; Registry_abi.conclude_epoch_selector]))
  | ["system"; state; block; contract; data] ->
      let* world = parse_world state in let* block = parse_block block in let* contract = address contract in let* data = unhex data in
      System_call.run world ~block ~contract ~data |> Result.map_error System_call.error_to_string |> Result.map (fun outcome ->
        String.concat "|" [Receipt.to_string (System_call.receipt outcome); world_text (System_call.world outcome); world_text (System_call.world_keeping_all_but_system outcome)])
  | ["pre"; state; block; context] ->
      let* world = parse_world state in let* block = parse_block block in let* context = parse_context block context in
      Block_execution.apply_pre_block world ~context |> Result.map_error Block_execution.error_to_string |> Result.map (fun pre ->
        pre_text pre ^ "|" ^ world_text (Block_execution.Pre_block.world pre))
  | ["close"; state; block; rewards; randomness] ->
      let* world = parse_world state in let* block = parse_block block in let* rewards = parse_list reward (csv rewards) in
      let* randomness = unhex randomness in let* randomness = Option.to_result ~none:"randomness" (Hash32.of_bytes randomness) in
      Epoch_close.close world ~block ~rewards ~randomness |> Result.map_error Epoch_close.error_to_string |> Result.map (fun (world, disposition) ->
        String.concat "|" [world_text world; hex (Epoch_close.first_calldata disposition); hex (Epoch_close.second_calldata disposition)])
  | ["run"; mode; state; block; context; transactions] ->
      let* world = parse_world state in let* block = parse_block block in let* context = parse_context block context in
      let* transactions = parse_list envelope (csv transactions) in
      let* pre = Block_execution.apply_pre_block world ~context |> Result.map_error Block_execution.error_to_string in
      if String.equal mode "0" then
        let* outcome = Block_execution.run_transactions pre ~context transactions |> Result.map_error Block_execution.error_to_string in
        complete pre context outcome []
      else
        let* outcome, invalid = Block_execution.run_transactions_skipping_invalid pre ~context transactions |> Result.map_error Block_execution.error_to_string in
        complete pre context outcome invalid
  | [] | _ :: _ -> Error "request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
