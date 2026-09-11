open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let address = Address_word.of_word U256.one
let dispatch line = match String.split_on_char ' ' line with
  | ["boundary"; extra; count] -> let* extra = unhex extra in let* count = integer count in
    let withdrawals = List.init count (fun index -> Withdrawal.make ~index ~validator_index:0 ~address ~amount:2) |> List.filter_map Fun.id in
    Ok (Epoch_boundary.of_extra_data extra ~withdrawals |> Result.fold ~error:Epoch_boundary.error_to_string ~ok:(fun boundary ->
      let commitment = Epoch_boundary.commitment boundary in
      String.concat ":" [string_of_bool (Epoch_boundary.is_closing boundary); hex (Epoch_boundary.extra_data commitment); string_of_int (List.length (Epoch_boundary.withdrawals commitment));
        hex (Epoch_boundary.withdrawals_root commitment); string_of_bool (Epoch_boundary.equal boundary Epoch_boundary.Open);
        Epoch_boundary.of_extra_data (Epoch_boundary.extra_data commitment) ~withdrawals:(Epoch_boundary.withdrawals commitment) |> Result.fold ~error:Epoch_boundary.error_to_string ~ok:(fun decoded -> string_of_bool (Epoch_boundary.equal boundary decoded))]))
  | ["context"; number; time; gas; root; position] -> let* number = word number in let* timestamp = word time in let* gas_limit = word gas in let* root = integer root in let* position = word position in
    let zero = U256.to_be_bytes U256.zero in let addr = Address_word.of_word U256.zero in
    let* parent_hash = Option.to_result ~none:"parent" (Tn_keccak.of_stored_bytes zero) in
    let* root_digest = Option.to_result ~none:"root" (Tn_crypto.Digest.of_bytes (U256.to_be_bytes (small root))) in
    let* batch = Option.to_result ~none:"batch" (Tn_crypto.Digest.of_bytes zero) in
    let block = Env.Block.make ~coinbase:addr ~timestamp ~number ~prevrandao:U256.zero ~gas_limit ~basefee:U256.zero ~basefee_address:addr ~chain_id:U256.one
      ~blob_gasprice:Env.Block.consensus_blob_gasprice ~hashes:Block_hashes.empty in
    Ok (Block_context.make ~block ~parent_hash ~consensus_root:(Digests.Output_digest.of_digest root_digest) ~nonce:(Units.Sequence_number.of_epoch_round Units.Epoch.zero Round.genesis)
      ~batch_digest:(Digests.Batch_digest.of_digest batch) ~position:(Batch_position.of_word position) ~boundary:Epoch_boundary.Open
      |> Result.fold ~error:Block_context.error_to_string ~ok:(fun context -> String.concat ":" [string_of_int (Block_context.number context); string_of_int (Block_context.timestamp context);
        string_of_int (Block_context.gas_limit context); string_of_bool (Block_context.is_genesis context); string_of_bool (Block_context.first_batch context); string_of_bool (Block_context.equal context context)]))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
