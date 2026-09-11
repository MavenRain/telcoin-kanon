open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let a = Address_word.of_word (small 1)
let b = Address_word.of_word (small 2)
let timestamp n = Units.Timestamp.of_sec (Int64.of_int n) |> Option.value ~default:Units.Timestamp.zero
let optional_time n = if n = 0 then None else Some (timestamp (n - 1))
let dispatch line = match String.split_on_char ' ' line with
  | ["schedule"; s; c; p; time] -> let* s = integer s in let* c = integer c in let* p = integer p in let* time = integer time in
    Ok (Fork_schedule.make ~shanghai:(timestamp s) ~cancun:(optional_time c) ~prague:(optional_time p) |> Result.fold ~error:Fork_schedule.error_to_string ~ok:(fun schedule ->
      String.concat ":" [Fork_schedule.to_string schedule; Spec.to_string (Fork_schedule.active_at schedule ~timestamp:(timestamp time));
        string_of_bool (Fork_schedule.equal schedule Fork_schedule.mainnet); string_of_bool (Fork_schedule.equal schedule Fork_schedule.testnet)]))
  | ["contract_address"; creator; nonce; salt; code; kind] -> let* creator = unhex creator in let* creator = Option.to_result ~none:"bad address" (Units.Address.of_bytes creator) in
    let* nonce = integer nonce in let* nonce = Option.to_result ~none:"bad nonce" (Nonce.of_int nonce) in let* salt = word salt in let* init_code = unhex code in let* kind = integer kind in
    Ok (hex (Units.Address.to_bytes (Contract_address.derive ~creator (if kind = 0 then Contract_address.From_nonce nonce else Contract_address.From_salt { salt; init_code }))))
  | ["intrinsic"; kind; data; addresses; slots; auths; length] -> let* kind = integer kind in let* data = unhex data in let* addresses = integer addresses in let* slots = integer slots in let* auths = integer auths in let* length = integer length in
    let access_list = List.init addresses (fun _ -> a, List.init slots (fun _ -> U256.one)) in
    Ok (String.concat ":" [string_of_int (Intrinsic.initial_gas ~kind:(if kind = 0 then Intrinsic.Call else Intrinsic.Create) ~data ~access_list ~authorizations:(List.init auths (fun _ -> ())));
      string_of_int (Intrinsic.floor_gas ~data); string_of_int (Intrinsic.tokens data); string_of_int (Intrinsic.num_words length)])
  | ["call_target"; target_code; delegate_code; prewarm] -> let* target_code = unhex target_code in let* delegate_code = unhex delegate_code in let* prewarm = integer prewarm in
    let world = World_state.set_account World_state.empty b (Account.with_code Account.empty delegate_code) in
    let initial = Effects.start ~world ~access:(Access.of_transaction ~addresses:(if prewarm = 0 then [] else [b]) ~slots:[]) in
    let target = Call_target.resolve initial (Account.with_code Account.empty target_code) in
    Ok (String.concat ":" [hex (Data.to_string (Code.window (Call_target.code target))); string_of_int (Call_target.surcharge target); Option.fold ~none:"none" ~some:(fun a -> hex (Units.Address.to_bytes a)) (Call_target.delegate target);
      string_of_bool (Effects.equal initial (Call_target.effects target)); string_of_bool (Access.mem_account (Effects.access (Call_target.effects target)) a);
      string_of_bool (Access.mem_account (Effects.access (Call_target.effects target)) b)])
  | ["depth"; n] -> let* n = integer n in let depth = List.init n Fun.id |> List.fold_left (fun depth _ -> Call_depth.succ depth) Call_depth.zero in
    Ok (String.concat ":" [string_of_int (Call_depth.to_int (Call_depth.succ depth)); string_of_bool (Call_depth.within_limit depth); string_of_bool (Call_depth.within_limit (Call_depth.succ depth))])
  | ["frame"; byte; body] -> let* type_byte = integer byte in let* body = unhex body in Ok (hex (Eip2718.frame ~type_byte body))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
