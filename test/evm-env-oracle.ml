open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let spec = function 0 -> Spec.Shanghai | 1 -> Spec.Cancun | unknown -> let _ = unknown in Spec.Prague
let position p = String.concat ":" [U256.to_hex (Batch_position.word p); string_of_bool (Batch_position.is_first_batch p);
  Option.fold ~none:"none" ~some:string_of_int (Batch_position.batch_index p);
  Option.fold ~none:"none" ~some:(fun w -> string_of_int (Units.Worker_id.to_int w)) (Batch_position.worker_id p)]
let hashes count = List.init count (fun i -> Tn_keccak.of_stored_bytes (U256.to_be_bytes (small (i + 1)))) |> List.filter_map Fun.id |> Block_hashes.of_recent
let dispatch line = match String.split_on_char ' ' line with
  | ["penalty"; limit; spent] -> let* gas_limit = integer limit in let* gas_spent = integer spent in Ok (string_of_int (Gas_penalty.penalty ~gas_limit ~gas_spent))
  | ["spec"; a; b; m] -> let* a = integer a in let* b = integer b in let* m = integer m in let mode = if m = 0 then Mutability.Mutable else Mutability.Static in
    Ok (String.concat ":" [Spec.to_string (spec a); string_of_bool (Spec.is_enabled (spec a) ~from:(spec b)); Mutability.to_string mode; string_of_bool (Mutability.is_static mode);
      Option.fold ~none:"none" ~some:(fun Mutability.Permit -> "permit") (Mutability.permit mode)])
  | ["position"; index; worker] -> let* batch_index = integer index in let* worker = integer worker in let* worker_id = Option.to_result ~none:"bad worker" (Units.Worker_id.of_int worker) in
    Ok (Option.fold ~none:"none" ~some:position (Batch_position.of_batch ~batch_index ~worker_id))
  | ["position_word"; raw] -> let* value = word raw in Ok (position (Batch_position.of_word value))
  | ["hashes"; count; current; requested] -> let* count = integer count in let* current = word current in let* requested = word requested in let h = hashes count in
    Ok (String.concat ":" [U256.to_hex (Block_hashes.lookup h ~current ~requested); string_of_bool (Block_hashes.equal h (hashes (min count 256))); string_of_bool (Block_hashes.equal h Block_hashes.empty)])
  | ["env"; s; m; changed] -> let* s = integer s in let* m = integer m in let* changed = integer changed in
    let a = Address_word.of_word (small 1) in let b = Address_word.of_word (small 2) in
    let block = Env.Block.make_at_spec ~spec:(spec s) ~coinbase:a ~timestamp:(small 10) ~number:(small 11) ~prevrandao:(small 12) ~gas_limit:(small 13)
      ~basefee:(small 14) ~basefee_address:b ~chain_id:(small 15) ~blob_gasprice:Env.Block.consensus_blob_gasprice ~hashes:(hashes 2) in
    let access_list = [a, [small 3; small 4]; b, []; a, [small 3]] in let tx = Env.Tx.make ~origin:a ~gas_price:(small 21) ~access_list in
    let call = Env.Call.make ~target:a ~caller:b ~value:(small 22) ~data:(Data.of_string "abc") ~mutability:(if m = 0 then Mutability.Mutable else Mutability.Static) in
    let env = Env.make ~block ~tx ~call in let next_call = if changed = 0 then call else Env.Call.make ~target:b ~caller:a ~value:U256.zero ~data:(Data.of_string "") ~mutability:Mutability.Static in
    let next = Env.with_call env next_call in let addresses, slots = Env.Tx.declared_warm tx in
    Ok (String.concat ":" [Spec.to_string (Env.Block.spec (Env.block next)); string_of_bool (Env.equal env next);
      string_of_bool (Env.Tx.equal tx (Env.Tx.make ~origin:a ~gas_price:(small 21) ~access_list:(List.rev access_list)));
      (addresses |> List.map (fun a -> hex (Units.Address.to_bytes a) ^ ",") |> String.concat "");
      (slots |> List.map (fun (a, slot) -> hex (Units.Address.to_bytes a) ^ "/" ^ U256.to_hex slot ^ ",") |> String.concat "");
      U256.to_hex (Env.Block.blob_gasprice block); string_of_bool (Env.Block.equal block (Env.block next)); string_of_bool (Env.Tx.equal tx (Env.tx next))])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
