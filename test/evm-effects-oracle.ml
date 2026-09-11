open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let small n = U256.of_int n |> Option.value ~default:U256.zero
let a = Address_word.of_word (small 1)
let b = Address_word.of_word (small 2)
let slot = U256.one
let permit = Mutability.Permit
let spec = function 0 -> Spec.Shanghai | 1 -> Spec.Cancun | unknown -> let _ = unknown in Spec.Prague
let account account = String.concat ":" [U256.to_hex (Account.balance account); Nonce.to_string (Account.nonce account); U256.to_hex (Account.slot account slot); hex (Account.code account)]
let summary effects =
  let world = Effects.world effects in let access = Effects.access effects in let lifecycle = Effects.lifecycle effects in
  String.concat ":" [account (World_state.account world a); account (World_state.account world b); U256.to_hex (World_state.storage (Effects.base effects) a slot);
    string_of_int (Refund.to_int (Effects.refund effects)); string_of_int (Log_journal.length (Effects.logs effects)); U256.to_hex (Effects.transient_load effects a ~slot);
    string_of_bool (Lifecycle.created_here lifecycle a); string_of_bool (Lifecycle.created_here lifecycle b);
    (Lifecycle.destroyed lifecycle |> List.map (fun a -> hex (Units.Address.to_bytes a) ^ ",") |> String.concat "");
    string_of_bool (Access.mem_account access a); string_of_bool (Access.mem_account access b); string_of_bool (Access.mem_slot access a slot); string_of_bool (Effects.equal effects effects)]
let option = Option.fold ~none:"none" ~some:(fun e -> "some:" ^ summary e)
let write load = let w = Effects.loaded load in String.concat ":" [U256.to_hex (Sstore_state.original w); U256.to_hex (Sstore_state.present w); U256.to_hex (Sstore_state.updated w);
  string_of_bool (Access.is_cold (Effects.warmth load)); string_of_int (Gas.sstore_dynamic_cost (Effects.warmth load) w); string_of_int (Refund.to_int (Gas.sstore_refund w))]
let two_balances from_balance to_balance nonce = World_state.set_account (World_state.set_account World_state.empty a (Account.make ~nonce ~balance:from_balance)) b (Account.make ~nonce:Nonce.zero ~balance:to_balance)
let dispatch line = match String.split_on_char ' ' line with
  | ["store"; original; next; last; created] -> let* original = word original in let* next = word next in let* last = word last in let* created = integer created in
    let initial = Effects.start ~world:(World_state.set_storage World_state.empty a slot original) ~access:Access.empty in
    let* start = Option.to_result ~none:"creation" (if created = 0 then Some initial else Effects.begin_creation initial permit ~creator:b ~created:a ~value:U256.zero) in
    let first = Effects.plan_store start permit a ~slot ~value:next in let committed = Effects.commit_store first in
    let second = Effects.plan_store committed permit a ~slot ~value:last in let done_ = Effects.commit_store second in
    let transient = Effects.transient_store done_ permit a ~slot ~value:last in
    let logged = Effects.log (Effects.log transient permit (Log.make ~address:a ~topics:Log.Topics.T0 ~data:"abc")) permit (Log.make ~address:b ~topics:Log.Topics.T0 ~data:"") in
    Ok (String.concat ":" [write first; write second; string_of_bool (World_state.equal (Effects.world (Effects.warmed first)) (Effects.world start));
      string_of_bool (World_state.equal (Effects.base logged) (Effects.world initial)); string_of_bool (Effects.equal initial logged); summary logged; summary initial])
  | ["transfer"; from_balance; to_balance; value; self; high_nonce] -> let* from_balance = word from_balance in let* to_balance = word to_balance in let* value = word value in let* self = integer self in let* high_nonce = integer high_nonce in
    let nonce = Nonce.of_int (if high_nonce = 0 then 0 else max_int) |> Option.value ~default:Nonce.zero in
    let initial = Effects.start ~world:(two_balances from_balance to_balance nonce) ~access:Access.empty in
    Ok (String.concat ":" [option (Effects.transfer initial ~from:a ~to_:(if self = 0 then b else a) ~value); option (Effects.bump_nonce initial a); summary initial])
  | ["creation"; from_balance; to_balance; value] -> let* from_balance = word from_balance in let* to_balance = word to_balance in let* value = word value in
    let world = World_state.set_storage (two_balances from_balance to_balance Nonce.zero) b slot (small 9) in let initial = Effects.start ~world ~access:Access.empty in
    let result = Effects.begin_creation initial permit ~creator:a ~created:b ~value |> Option.map (fun born -> Effects.deploy_code born permit b "\x60\x01") in
    Ok (option result ^ ":" ^ summary initial)
  | ["destruction"; balance; beneficiary_balance; fork; created; self] -> let* balance = word balance in let* beneficiary_balance = word beneficiary_balance in let* fork = integer fork in let* created = integer created in let* self = integer self in
    let world = World_state.set_storage (two_balances balance beneficiary_balance Nonce.zero) a slot (small 7) in let initial = Effects.start ~world ~access:Access.empty in
    let* prepared = Option.to_result ~none:"creation" (if created = 0 then Some initial else Effects.begin_creation initial permit ~creator:b ~created:a ~value:U256.zero) in
    let start = Effects.deploy_code prepared permit a "\x60\x00" in let load = Effects.plan_destruction start ~address:a ~beneficiary:(if self = 0 then b else a) in let plan = Effects.loaded load in
    Ok (String.concat ":" [string_of_bool (Access.is_cold (Effects.warmth load)); string_of_bool (Destruction.had_value plan); string_of_bool (Destruction.beneficiary_exists plan);
      string_of_bool (Destruction.deletes plan); option (Effects.commit_destruction load permit ~spec:(spec fork)); summary start])
  | ["reads"; prewarm; self] -> let* prewarm = integer prewarm in let* self = integer self in
    let world = World_state.set_storage (World_state.set_account World_state.empty a (Account.make ~nonce:Nonce.zero ~balance:(small 8))) a slot (small 9) in
    let initial = Effects.start ~world ~access:(Access.of_transaction ~addresses:(if prewarm = 0 then [] else [a]) ~slots:[]) in
    let first = Effects.balance initial a in let second = Effects.ext_account (Effects.warmed first) a in let third = Effects.storage (Effects.warmed second) a ~slot in
    let fourth = Effects.storage (Effects.warmed third) a ~slot in let target = if self = 0 then b else a in
    let self_balance, warmed = Effects.self_balance (Effects.warmed fourth) target in let self_account, warmed = Effects.self_account warmed target in
    Ok (String.concat ":" [U256.to_hex (Effects.loaded first); account (Effects.loaded second); U256.to_hex (Effects.loaded third);
      string_of_bool (Access.is_cold (Effects.warmth first)); string_of_bool (Access.is_cold (Effects.warmth second)); string_of_bool (Access.is_cold (Effects.warmth third));
      string_of_bool (Access.is_cold (Effects.warmth fourth)); U256.to_hex self_balance; account self_account; summary warmed])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
