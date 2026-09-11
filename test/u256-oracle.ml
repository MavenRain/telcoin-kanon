open Oracle_bytes
let ( let* ) = Result.bind
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let option_text = Option.fold ~none:"none" ~some:U256.to_hex
let dispatch line = match String.split_on_char ' ' line with
  | ["op"; op; a; b; n] -> let* a = word a in let* b = word b in let* n = word n in
    (match op with
    | "0" -> Ok (U256.to_hex (U256.add a b)) | "1" -> Ok (U256.to_hex (U256.sub a b))
    | "2" -> Ok (option_text (U256.checked_add a b)) | "3" -> Ok (option_text (U256.checked_sub a b))
    | "4" -> Ok (U256.to_hex (U256.mul a b)) | "5" -> Ok (option_text (U256.udiv a b))
    | "6" -> Ok (option_text (U256.urem a b)) | "7" -> Ok (option_text (U256.add_mod a b n))
    | "8" -> Ok (option_text (U256.mul_mod a b n)) | "9" -> Ok (U256.to_hex (U256.pow a b))
    | "10" -> Ok (U256.to_hex (U256.logand a b)) | "11" -> Ok (U256.to_hex (U256.logor a b))
    | "12" -> Ok (U256.to_hex (U256.logxor a b)) | "13" -> Ok (U256.to_hex (U256.lognot a))
    | "14" -> Ok (U256.to_hex (U256.shl a b)) | "15" -> Ok (U256.to_hex (U256.shr a b))
    | _ -> Error "bad op")
  | ["int"; raw] -> let* n = Option.to_result ~none:"bad int" (int_of_string_opt raw) in
      Ok (String.concat ":" [option_text (U256.of_int n); U256.to_hex (U256.of_byte n); U256.to_hex (U256.two_pow n)])
  | ["word"; raw] -> Ok (U256.of_hex raw |> Option.fold ~none:"none" ~some:(fun word ->
      String.concat ":" [U256.to_hex word; Option.fold ~none:"none" ~some:string_of_int (U256.to_int word); string_of_bool (U256.is_zero word)]))
  | ["bytes"; raw] -> let* raw = unhex raw in Ok (option_text (U256.of_be_bytes raw))
  | ["bits"; raw] -> let* n = Option.to_result ~none:"bad bits" (Int64.of_string_opt raw) in Ok (U256.to_hex (U256.of_u64_bits n))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
