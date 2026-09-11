open Oracle_bytes
let ( let* ) = Result.bind
let outcome = function
  | Precompile.Succeeded { gas_used; output } -> "s:" ^ string_of_int gas_used ^ ":" ^ hex output
  | Precompile.Rejected -> "rejected" | Precompile.Not_a_precompile -> "not-precompile"
let dispatch line = match String.split_on_char ' ' line with
  | [gas; bytes] -> let* gas_limit = Option.to_result ~none:"bad int" (int_of_string_opt gas) in let* input = unhex bytes in
    Ok (outcome (Precompile.modexp ~input ~gas_limit))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
