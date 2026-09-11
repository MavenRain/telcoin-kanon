open Oracle_bytes
let ( let* ) = Result.bind
let decode codec raw = Bcs.decode codec raw |> Result.map_error Bcs.error_to_string
let decode_hex codec raw = let* raw = unhex raw in decode codec raw
let word = Bcs.refine ~inject:(fun raw -> U256.of_be_bytes raw |> Option.to_result ~none:"bad word") ~project:U256.to_be_bytes (Bcs.fixed_bytes 32)
let address = Bcs.refine ~inject:(fun raw -> Units.Address.of_bytes raw |> Option.to_result ~none:"bad address") ~project:Units.Address.to_bytes (Bcs.fixed_bytes 20)
let slots = Bcs.list (Bcs.pair word word)
let raw_account = Bcs.pair Bcs.u64 (Bcs.pair word (Bcs.pair Bcs.bytes slots))
let nonce value = if Int64.unsigned_compare value (Int64.of_int max_int) > 0 then Error "bad nonce"
  else Option.to_result ~none:"bad nonce" (Nonce.of_int (Int64.to_int value))
let account (n, (balance, (code, slots))) = let* nonce = nonce n in
  Ok (List.fold_left (fun acc (key, value) -> Account.set_slot acc key value) (Account.with_code (Account.make ~nonce ~balance) code) slots)
let account_wire a = Bcs.encode raw_account (Int64.of_int (Nonce.to_int (Account.nonce a)), (Account.balance a, (Account.code a, Storage.bindings (Account.storage a)))) |> hex
let class_text = function
  | Delegation.Codeless -> "codeless"
  | Delegation.Contract -> "contract"
  | Delegation.Delegated target -> "delegated:" ^ hex (Units.Address.to_bytes (Delegation.target target))
  | Delegation.Undecodable error -> "undecodable:" ^ Delegation.decode_error_to_string error
let deployment_text = function
  | Bytecode.Reserved_prefix -> "reserved"
  | Bytecode.Too_large n -> "large:" ^ string_of_int n
let account_text a = String.concat ":" [account_wire a; string_of_bool (Account.is_empty a); string_of_bool (Account.is_absent a);
  string_of_bool (Account.is_occupied a); Tn_keccak.to_hex (Account.code_hash a); class_text (Account.code_class a)]
let account_run initial actions =
  let* _, output = List.fold_left (fun result (raw, kind) -> let* state, output = result in
    let text_opt opt = Option.fold ~none:(state, "none") ~some:(fun next -> next, "ok") opt in
    let* next, result = match kind with
      | 0 -> let* key, value = decode (Bcs.pair word word) raw in Ok (Account.set_slot state key value, "ok")
      | 1 -> let* value = decode word raw in Ok (text_opt (Account.credit state value))
      | 2 -> let* value = decode word raw in Ok (text_opt (Account.debit state value))
      | 3 -> Ok (Account.increment_nonce state, "ok")
      | 4 -> Ok (text_opt (Account.increment_nonce_checked state))
      | 5 -> let* code = decode Bcs.bytes raw in Ok (Account.with_code state code, "ok")
      | 6 -> let* target = decode address raw in Ok (Account.delegate state target, "ok")
      | 7 -> let* slots = decode slots raw in let storage = List.fold_left (fun acc (key, value) -> Storage.set acc key value) Storage.empty slots in Ok (Account.with_storage state storage, "ok")
      | unknown -> Error ("bad action:" ^ string_of_int unknown) in
    Ok (next, (result ^ ":" ^ string_of_bool (Account.equal state next) ^ ":" ^ account_text next) :: output)) (Ok (initial, [account_text initial])) actions in
  Ok (String.concat ";" (List.rev output))
let transfer_codec = Bcs.pair address (Bcs.pair address (Bcs.pair word Bcs.u64))
let world_text world = World_state.accounts world |> List.map (fun (addr, account) -> hex (Units.Address.to_bytes addr) ^ ":" ^ account_wire account) |> String.concat ","
let dispatch line = match String.split_on_char ' ' line with
  | ["code"; raw] -> let* code = unhex raw in
      let deployed = Bytecode.validate_deployment code |> Result.fold ~ok:(fun () -> "ok") ~error:deployment_text in
      Ok (String.concat "/" [class_text (Delegation.classify code); string_of_bool (Delegation.is_contract_code code); deployed; Tn_keccak.to_hex (Bytecode.hash (Bytecode.of_string code))])
  | ["account"; raw; actions] -> let* value = decode_hex raw_account raw in let* initial = account value in
      let* actions = decode_hex (Bcs.list (Bcs.pair Bcs.bytes Bcs.u8)) actions in account_run initial actions
  | ["world"; raw; transfers] -> let* entries = decode_hex (Bcs.list (Bcs.pair address raw_account)) raw in
      let* entries = List.fold_right (fun (address, (n, (balance, (code, storage)))) acc -> let* entries = acc in let* nonce = nonce n in
        Ok ((address, Genesis_account.make ~nonce ~balance ~code:(Some code) ~storage) :: entries)) entries (Ok []) in
      let* state = World_state.of_genesis_alloc entries |> Result.map_error World_state.error_to_string in
      let* transfers = decode_hex (Bcs.list transfer_codec) transfers in
      let* _, output = List.fold_left (fun result (sender, (recipient, (value, n))) -> let* state, output = result in let* nonce = nonce n in
        let next, outcome = Transfer.apply state (Transfer.make ~sender ~recipient ~value ~nonce) |> Result.fold
          ~error:(fun error -> state, "error:" ^ Transfer.error_to_string error) ~ok:(fun next -> next, "ok") in
        Ok (next, (outcome ^ "|" ^ string_of_bool (World_state.equal state next) ^ "|" ^ world_text next) :: output)) (Ok (state, [world_text state])) transfers in
      Ok ("trace:" ^ String.concat ";" (List.rev output))
  | ["address"; raw] -> let* word = Option.to_result ~none:"bad word" (U256.of_hex raw) in
      let address = Address_word.of_word word in Ok (hex (Units.Address.to_bytes address) ^ ":" ^ U256.to_hex (Address_word.to_word address))
  | ["nonce"; raw] -> let* value = Option.to_result ~none:"bad int" (int_of_string_opt raw) in
      Ok (Nonce.of_int value |> Option.fold ~none:"none" ~some:(fun n -> String.concat ":" [Nonce.to_string n; Nonce.to_string (Nonce.succ n); Option.fold ~none:"none" ~some:Nonce.to_string (Nonce.succ_checked n)]))
  | [] -> Error "bad request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
