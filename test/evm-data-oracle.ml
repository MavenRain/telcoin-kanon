open Oracle_bytes
let ( let* ) = Result.bind
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let integer text = Option.to_result ~none:"bad int" (int_of_string_opt text)
let address text = let* bytes = unhex text in Option.to_result ~none:"bad address" (Units.Address.of_bytes bytes)
let dispatch line = match String.split_on_char ' ' line with
  | ["data"; raw; offset; count; signed] -> let* raw = unhex raw in let* offset = word offset in let* count = integer count in let* signed = integer signed in
    let data = Data.of_string raw in let code = Code.of_string raw in
    Ok (String.concat ":" [string_of_int (Data.length data); string_of_int (Data.start_of data offset); hex (Data.read data ~offset ~length:count);
      U256.to_hex (Data.word_at data offset); string_of_int (Code.byte_at code signed); string_of_bool (Code.is_valid_jumpdest code signed);
      (Code.jumpdests code |> List.map (fun n -> string_of_int n ^ ",") |> String.concat ""); string_of_bool (Data.equal (Code.window code) data)])
  | ["transient"; a; b; slot; value] -> let* a = address a in let* b = address b in let* slot = word slot in let* value = word value in
    let first = Transient.set Transient.empty a ~slot ~value in
    let second = Transient.set first b ~slot ~value:(U256.add value U256.one) in
    let third = Transient.set second a ~slot ~value:U256.zero in
    let cleared = Transient.set third b ~slot ~value:U256.zero in
    Ok (String.concat ":" [U256.to_hex (Transient.get second a ~slot); U256.to_hex (Transient.get second b ~slot); string_of_int (Transient.length second);
      U256.to_hex (Transient.get third a ~slot); U256.to_hex (Transient.get third b ~slot); string_of_int (Transient.length third);
      string_of_bool (Transient.is_empty cleared); string_of_bool (Transient.equal cleared Transient.empty)])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
