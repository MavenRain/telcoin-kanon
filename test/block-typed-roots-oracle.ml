open Oracle_bytes
open Receipt_fixture_helpers
let raw text = unhex (if String.equal text "-" then "" else text)
let transaction kind =
  let fee = match kind with
    | 0 -> Transaction.Legacy {gas_price=U256.one}
    | 1 -> Transaction.Access_list {gas_price=U256.one}
    | 2 -> Transaction.Dynamic {max_fee=U256.one;max_priority=None}
    | _ -> Transaction.Set_code {max_fee=U256.one;max_priority=U256.zero;target=Tn_types.Units.Address.zero;authorizations=[]}
  in Transaction.make ~sender:Tn_types.Units.Address.zero ~nonce:Nonce.zero ~gas_limit:21000
    ~kind:Transaction.Create ~value:U256.zero ~data:"" ~access_list:[] ~chain_id:None ~fee
let rec envelopes = function
  | [] -> Ok []
  | head :: tail -> let* head = raw head in let* head = Tx_envelope.decode_2718 head |> Result.map_error Tx_envelope.error_to_string in
      let* tail = envelopes tail in Ok (head :: tail)
let run = function
  | ["receipts"; kinds; statuses; gas] ->
      let* kinds = raw kinds in let* statuses = raw statuses in let* gas = integer gas in
      let txs = String.to_seq kinds |> Seq.map (fun byte -> transaction (Char.code byte)) |> List.of_seq in
      let receipts = String.to_seq statuses |> Seq.map (fun byte -> receipt (Char.code byte) gas (logs 2 "data")) |> List.of_seq in
      Ok (Option.fold ~none:"none" ~some:hex (Block_roots.receipts_root_of_block txs receipts))
  | ["transactions"; wires] ->
      let* wires = envelopes (if String.equal wires "-" then [] else String.split_on_char ',' wires) in
      Ok (hex (Block_roots.transactions_root_of wires))
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
