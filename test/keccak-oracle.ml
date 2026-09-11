let () = In_channel.input_lines stdin |> List.iter (fun raw ->
  Oracle_bytes.unhex raw |> Result.map (fun bytes -> Tn_keccak.to_hex (Tn_keccak.digest bytes))
  |> Result.fold ~ok:Fun.id ~error:(fun text -> "error: " ^ text) |> print_endline)
