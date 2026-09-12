open Oracle_bytes
let ( let* ) = Result.bind
module Address = Tn_types.Units.Address
let word raw = let* bytes = unhex raw in Option.to_result ~none:"bad word" (U256.of_be_bytes bytes)
let address raw = let* bytes = unhex raw in Option.to_result ~none:"bad address" (Address.of_bytes bytes)
let parse raw =
  let* bytes = unhex raw in
  let* item = Rlp.decode_exact bytes |> Result.map_error Rlp.error_to_string in
  Tx_envelope.read_signed_authorization item |> Result.map_error Tx_envelope.error_to_string
let describe sg =
  String.concat "|" [hex (Authorization.encode (Authorization.unsigned sg)); hex (Authorization.encode_signed sg);
    hex (Authorization.signature_hash (Authorization.unsigned sg));
    Option.fold ~none:"none" ~some:(fun signature -> if Tx_signature.parity signature then "1" else "0") (Authorization.signature sg)]
let account_text (address, account) =
  String.concat ":" [hex (Address.to_bytes address); Nonce.to_string (Account.nonce account);
    hex (U256.to_be_bytes (Account.balance account)); hex (Account.code account);
    hex (U256.to_be_bytes (Storage.get (Account.storage account) U256.zero))] ^ ";"
let dispatch line = match String.split_on_char ' ' line with
  | ["describe"; input] -> Result.map describe (parse input)
  | ["make"; chain; target; nonce] ->
      let* chain_id = word chain in let* address = address target in let* nonce = word nonce in
      Ok (Option.fold ~none:"none" ~some:(fun auth -> hex (Authorization.encode auth)) (Authorization.make ~chain_id ~address ~nonce))
  | ["screen"; chain; input] ->
      let* chain_id = word chain in let* sg = parse input in
      Ok (Option.fold ~none:"none" ~some:(fun scr -> String.concat ":" [
        hex (Address.to_bytes (Authorization.authority scr)); hex (U256.to_be_bytes (Authorization.screened_nonce scr));
        hex (Delegation.code_of_assignment (Authorization.screened_assignment scr))]) (Authorization.screen ~chain_id sg))
  | ["apply"; chain; input; target; nonce; balance; code; slot] ->
      let* chain_id = word chain in let* address = address target in let* n = word nonce in
      let* nonce = Option.to_result ~none:"bad nonce" (Option.bind (U256.to_int n) Nonce.of_int) in
      let* balance = word balance in let* code = unhex code in let* slot = word slot in let* bytes = unhex input in
      let* item = Rlp.decode_exact bytes |> Result.map_error Rlp.error_to_string in
      let* entries = Tx_envelope.read_authorization_list item |> Result.map_error Tx_envelope.error_to_string in
      let account = Account.make ~nonce ~balance |> fun a -> Account.with_code a code |> fun a -> Account.set_slot a U256.zero slot in
      let world = World_state.set_account World_state.empty address account in
      let result = Auth_list.apply ~world ~chain_id entries in
      Ok (String.concat "|" [string_of_int (Auth_list.refund result);
        String.concat "" (List.map (fun a -> hex (Address.to_bytes a) ^ ";") (Auth_list.warmed result));
        String.concat "" (List.map (fun d -> Auth_list.disposition_to_string d ^ ";") (Auth_list.dispositions result));
        String.concat "" (List.map account_text (World_state.accounts (Auth_list.world result)))])
  | ["recover"; input] ->
      let* bytes = unhex input in
      let* env = Tx_envelope.decode_2718 bytes |> Result.map_error Tx_envelope.error_to_string in
      let* tx = Tx_recovery.recover env |> Result.map_error Tx_recovery.error_to_string in
      Ok (String.concat "|" [hex (Address.to_bytes (Transaction.sender tx)); Nonce.to_string (Transaction.nonce tx);
        string_of_int (Transaction.gas_limit tx); hex (Tx_envelope.enc_kind (Transaction.kind tx));
        hex (U256.to_be_bytes (Transaction.value tx)); hex (Transaction.data tx);
        hex (Tx_envelope.enc_access_list (Transaction.access_list tx)); hex (Tx_envelope.enc_authorization_list (Transaction.authorizations tx))])
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
