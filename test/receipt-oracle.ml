open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let address n = Address_word.of_word (small n)
let logs count data = if count = 0 then [] else Log.make ~address:(address 1) ~topics:(Log.Topics.T2 (U256.zero, small 128)) ~data ::
  (if count = 1 then [] else [Log.make ~address:(address 2) ~topics:Log.Topics.T0 ~data:""])
let receipt status gas_used logs = match status with
  | 0 -> Receipt.Success { output = "output"; created = Some (address 1); gas_used; gas_refunded = 7; logs }
  | 1 -> Receipt.Reverted { output = "revert"; gas_used }
  | unknown -> let _ = unknown in Receipt.Halted { reason = Receipt.Frame_halt Interpreter.Out_of_gas; gas_used }
let meter_text meter = String.concat ":" [string_of_int (Block_gas.limit meter); string_of_int (Block_gas.used meter); string_of_int (Block_gas.available meter); string_of_bool (Block_gas.equal meter meter)]
let meter_step meter gas_used = Block_gas.charge_receipt meter (Receipt.Reverted { output = ""; gas_used }) |> Option.fold ~none:(meter, "none") ~some:(fun next -> next, "some:" ^ meter_text next)
let dispatch line = match String.split_on_char ' ' line with
  | ["receipt"; status; used; cumulative; type_byte; count; data] -> let* status = integer status in let* gas_used = integer used in let* cumulative_gas_used = integer cumulative in let* type_byte = integer type_byte in let* count = integer count in let* data = unhex data in
    let r = receipt status gas_used (logs count data) in
    Ok (String.concat ":" [Receipt.to_string r; string_of_bool (Receipt_envelope.status r); string_of_int (List.length (Receipt.logs r)); hex (Receipt_envelope.encode_2718 ~type_byte ~cumulative_gas_used r);
      hex (Block_roots.receipts_root [type_byte, r; 2, Receipt.Reverted { output = ""; gas_used = 1 }])])
  | ["block_meter"; limit; first; second] -> let* limit = integer limit in let* first = integer first in let* second = integer second in
    if limit < 0 then Error "negative limit" else
    let* parent_hash = Option.to_result ~none:"parent" (Tn_keccak.of_stored_bytes (U256.to_be_bytes U256.zero)) in
    let block = Env.Block.make ~coinbase:(address 0) ~timestamp:U256.zero ~number:U256.zero ~prevrandao:U256.zero ~gas_limit:(small limit) ~basefee:U256.zero
      ~basefee_address:(address 0) ~chain_id:U256.one ~blob_gasprice:Env.Block.consensus_blob_gasprice ~hashes:Block_hashes.empty in
    let* context = Block_context.make ~block ~parent_hash ~consensus_root:Digests.Output_digest.zero ~nonce:(Units.Sequence_number.of_epoch_round Units.Epoch.zero Round.genesis)
      ~batch_digest:Digests.Batch_digest.zero ~position:(Batch_position.of_word U256.zero) ~boundary:Epoch_boundary.Open |> Result.map_error Block_context.error_to_string in
    let start = Block_gas.start context in let meter, first = meter_step start first in let _, second = meter_step meter second in
    Ok (String.concat ":" [meter_text start; first; second])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
