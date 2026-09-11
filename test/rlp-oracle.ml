open Oracle_bytes
let ( let* ) = Result.bind
let view = function
  | Rlp.Str bytes -> "s:" ^ hex bytes
  | Rlp.List items -> "l:" ^ (items |> List.map (fun item -> hex (Rlp.encode item) ^ ",") |> String.concat "")
let dispatch line = match String.split_on_char ' ' line with
  | ["encode"; raw] -> let* bytes = unhex raw in
    Ok (String.concat ":" [hex (Rlp.encode_bytes bytes); hex (Rlp.encode_scalar bytes); hex (Rlp.encode (Rlp.List [Rlp.Str bytes; Rlp.List [Rlp.Str ""]]))])
  | ["nat"; raw] -> let* n = Option.to_result ~none:"bad int" (int_of_string_opt raw) in
    Ok (String.concat ":" [hex (Rlp.encode_nat n); hex (Rlp.big_endian n); string_of_int (Rlp.length_of_length n)])
  | ["decode"; raw; exact] -> let* bytes = unhex raw in
    Ok (if exact = "1" then Rlp.decode_exact bytes |> Result.fold ~error:Rlp.error_to_string ~ok:(fun item -> hex (Rlp.encode item) ^ ":" ^ view item)
      else Rlp.decode bytes |> Result.fold ~error:Rlp.error_to_string ~ok:(fun (item, rest) -> String.concat ":" [hex (Rlp.encode item); hex rest; view item]))
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
