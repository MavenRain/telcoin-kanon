open Oracle_bytes
let ( let* ) = Result.bind
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let address raw = let* raw = unhex raw in Option.to_result ~none:"bad address" (Units.Address.of_bytes raw)
let decode codec raw = let* raw = unhex raw in Bcs.decode codec raw |> Result.map_error Bcs.error_to_string
let address_codec = Bcs.refine (Bcs.fixed_bytes 20) ~inject:(fun raw -> Option.to_result ~none:"address" (Units.Address.of_bytes raw)) ~project:Units.Address.to_bytes
let nonce_codec = Bcs.refine Bcs.u64 ~inject:(fun raw -> Option.to_result ~none:"nonce" (Nonce.of_int (Int64.to_int raw))) ~project:(fun n -> Int64.of_int (Nonce.to_int n))
let word_codec = Bcs.refine ~inject:(fun raw -> U256.of_be_bytes raw |> Option.to_result ~none:"bad word") ~project:U256.to_be_bytes (Bcs.fixed_bytes 32)
let slots_codec = Bcs.list (Bcs.pair word_codec word_codec)
let account_codec = Bcs.iso (Bcs.pair nonce_codec (Bcs.pair word_codec (Bcs.pair Bcs.bytes slots_codec)))
  ~inject:(fun (nonce, (balance, (code, slots))) -> Account.with_code (Account.with_storage (Account.make ~nonce ~balance) (List.fold_left (fun storage (key, value) -> Storage.set storage key value) Storage.empty slots)) code)
  ~project:(fun account -> Account.nonce account, (Account.balance account, (Account.code account, Storage.bindings (Account.storage account))))
let dispatch line = match String.split_on_char ' ' line with
  | ["withdrawal"; index; validator; addr; amount] -> let* index = integer index in let* validator_index = integer validator in let* address = address addr in let* amount = integer amount in
    Ok (Withdrawal.make ~index ~validator_index ~address ~amount |> Option.fold ~none:"none" ~some:(fun withdrawal ->
      let other = Withdrawal.make ~index:0 ~validator_index:0 ~address ~amount:1 |> Option.value ~default:withdrawal in
      String.concat ":" [Withdrawal.to_string withdrawal; hex (Withdrawal.encode_rlp withdrawal); hex (Block_roots.withdrawals_root [withdrawal; other]);
        hex (Block_roots.withdrawals_root [other; withdrawal]); string_of_bool (Withdrawal.equal withdrawal other); hex (Block_roots.withdrawals_root [])]))
  | ["bloom"; initial; input; addr; topic] -> let* initial = unhex initial in let* input = unhex input in let* address = address addr in let* topic = word topic in
    Ok (Bloom.of_bytes initial |> Option.fold ~none:"none" ~some:(fun initial -> let accrued = Bloom.accrue initial input in
      let logs = [Log.make ~address ~topics:(Log.Topics.T2 (topic, U256.zero)) ~data:input; Log.make ~address ~topics:Log.Topics.T0 ~data:""] in
      String.concat ":" [hex (Bloom.to_bytes accrued); hex (Bloom.to_bytes (Bloom.of_logs logs)); string_of_bool (Bloom.equal accrued (Bloom.accrue accrued input));
        string_of_bool (Bloom.equal (Bloom.of_logs []) Bloom.empty); Option.fold ~none:"none" ~some:(fun decoded -> string_of_bool (Bloom.equal decoded accrued)) (Bloom.of_bytes (Bloom.to_bytes accrued))]))
  | ["state_roots"; raw] -> let* accounts = decode (Bcs.list (Bcs.pair address_codec account_codec)) raw in
    let build = List.fold_left (fun world (address, account) -> World_state.set_account world address account) World_state.empty in
    let world = build accounts in let account = World_state.account world (Address_word.of_word U256.one) in
    Ok (String.concat ":" [hex (Block_roots.storage_root account); hex (Block_roots.account_leaf account); hex (Block_roots.state_root world);
      string_of_bool (Block_roots.agree world (build (List.rev (World_state.accounts world)))); string_of_bool (Block_roots.agree world World_state.empty)])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
