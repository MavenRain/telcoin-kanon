open Oracle_bytes
let ( let* ) = Result.bind
let describe tx =
  String.concat "|" [hex (Tn_keccak.to_bytes (Tx_shape.hash tx));
    (if Tx_shape.is_eip4844 tx then "1" else "0");
    Printf.sprintf "%016Lx" (Tx_shape.gas_limit tx)]
let dispatch line = match String.split_on_char ' ' line with
  | ["decode"; raw] ->
      let* bytes = unhex raw in
      Tx_shape.decode bytes |> Result.map describe |> Result.map_error Tx_shape.error_to_string
  | ["recover"; raw] ->
      let* bytes = unhex raw in
      let* tx = Tx_shape.decode bytes |> Result.map_error Tx_shape.error_to_string in
      Tx_shape.recover_signer tx |> Result.map (fun address -> hex (Tn_types.Units.Address.to_bytes address))
      |> Result.map_error Tx_shape.error_to_string
  | ["checked"; raw] ->
      let* bytes = unhex raw in
      Tx_shape.decode_and_recover bytes |> Result.map describe |> Result.map_error Tx_shape.error_to_string
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
