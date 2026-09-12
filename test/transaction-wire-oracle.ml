open Oracle_bytes
let ( let* ) = Result.bind
let word raw =
  let* bytes = unhex raw in
  Option.to_result ~none:"bad word" (U256.of_be_bytes bytes)
let word_hex value = hex (U256.to_be_bytes value)
let dispatch line = match String.split_on_char ' ' line with
  | ["decode"; input] ->
      let* bytes = unhex input in
      Tx_envelope.decode_2718 bytes
      |> Result.map_error Tx_envelope.error_to_string
      |> Result.map (fun env -> String.concat "|" [
          hex (Tx_envelope.encode_2718 env);
          hex (Tx_envelope.signing_payload (Tx_envelope.payload env));
          hex (Tx_envelope.signature_hash (Tx_envelope.payload env)); hex (Tx_envelope.hash env)])
  | ["parity"; input] ->
      let* value = word input in
      Ok (Option.fold ~none:"none" ~some:(fun (parity, chain) ->
        (if parity then "1:" else "0:") ^ Option.fold ~none:"none" ~some:word_hex chain)
        (Tx_signature.of_eip155_value value))
  | ["v"; parity; has_chain; input] ->
      let* value = word input in
      Ok (word_hex (Tx_signature.to_eip155_value ~parity:(String.equal parity "1")
        ~chain_id:(if String.equal has_chain "0" then None else Some value)))
  | ["price"; mode; max_raw; priority_raw; base_raw] ->
      let* maximum = word max_raw in
      let* priority = word priority_raw in
      let* base_fee = word base_raw in
      let fee = match mode with
        | "0" -> Transaction.Legacy {gas_price=maximum}
        | "1" -> Transaction.Access_list {gas_price=maximum}
        | "2" -> Transaction.Dynamic {max_fee=maximum;max_priority=None}
        | "3" -> Transaction.Dynamic {max_fee=maximum;max_priority=Some priority}
        | _ -> Transaction.Set_code {max_fee=maximum;max_priority=priority;target=Tn_types.Units.Address.zero;authorizations=[]}
      in
      let tx = Transaction.make ~sender:Tn_types.Units.Address.zero ~nonce:Nonce.zero ~gas_limit:0
        ~kind:Transaction.Create ~value:U256.zero ~data:"" ~access_list:[] ~chain_id:None ~fee in
      let kind = match Transaction.kind tx with Transaction.Create -> "create" | Transaction.Call address -> hex (Tn_types.Units.Address.to_bytes address) in
      Ok (String.concat ":" [word_hex (Transaction.effective_gas_price tx ~base_fee);word_hex (Transaction.max_fee_per_gas tx);kind])
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
