open Oracle_bytes
let ( let* ) = Result.bind
let outcome = function
  | Precompile.Succeeded { gas_used; output } -> "s:" ^ string_of_int gas_used ^ ":" ^ hex output
  | Precompile.Rejected -> "rejected" | Precompile.Not_a_precompile -> "not-precompile"
let dispatch line = match String.split_on_char ' ' line with
  | [address; gas; bytes] ->
    let* raw_address = unhex address in
    let* gas_limit = Option.to_result ~none:"bad int" (int_of_string_opt gas) in
    let* input = unhex bytes in
    let* word = Option.to_result ~none:"bad address" (U256.of_be_bytes (String.make 12 '\000' ^ raw_address)) in
    Ok (outcome (Precompile.invoke (Address_word.of_word word) ~input ~gas_limit))
  | [] -> Error "empty request" | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
