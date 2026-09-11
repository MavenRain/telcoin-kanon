let ( let* ) = Result.bind
let word text = Option.to_result ~none:"bad word" (U256.of_hex text)
let dispatch line = match String.split_on_char ' ' line with
  | ["alu"; op; a; b; n] -> let* a = word a in let* b = word b in let* n = word n in
    (match op with
    | "1" -> Ok (U256.to_hex (Alu.add a b))
    | "2" -> Ok (U256.to_hex (Alu.mul a b))
    | "3" -> Ok (U256.to_hex (Alu.sub a b))
    | "4" -> Ok (U256.to_hex (Alu.div a b))
    | "5" -> Ok (U256.to_hex (Alu.sdiv a b))
    | "6" -> Ok (U256.to_hex (Alu.modulo a b))
    | "7" -> Ok (U256.to_hex (Alu.smod a b))
    | "8" -> Ok (U256.to_hex (Alu.addmod a b n))
    | "9" -> Ok (U256.to_hex (Alu.mulmod a b n))
    | "10" -> Ok (U256.to_hex (Alu.exp a b))
    | "11" -> Ok (U256.to_hex (Alu.signextend a b))
    | "16" -> Ok (U256.to_hex (Alu.lt a b))
    | "17" -> Ok (U256.to_hex (Alu.gt a b))
    | "18" -> Ok (U256.to_hex (Alu.slt a b))
    | "19" -> Ok (U256.to_hex (Alu.sgt a b))
    | "20" -> Ok (U256.to_hex (Alu.eq a b))
    | "21" -> Ok (U256.to_hex (Alu.iszero a))
    | "22" -> Ok (U256.to_hex (Alu.logand a b))
    | "23" -> Ok (U256.to_hex (Alu.logor a b))
    | "24" -> Ok (U256.to_hex (Alu.logxor a b))
    | "25" -> Ok (U256.to_hex (Alu.lognot a))
    | "26" -> Ok (U256.to_hex (Alu.byte a b))
    | "27" -> Ok (U256.to_hex (Alu.shl a b))
    | "28" -> Ok (U256.to_hex (Alu.shr a b))
    | "29" -> Ok (U256.to_hex (Alu.sar a b))
    | unknown -> Error ("bad op:" ^ unknown))
  | ["opcode"; raw] -> let* byte = Option.to_result ~none:"bad byte" (int_of_string_opt raw) in
    Ok (Opcode.decode byte |> Option.fold ~none:"none" ~some:(fun op ->
      String.concat ":" [Opcode.to_string op; string_of_int (Opcode.to_byte op); string_of_int (Opcode.immediate_bytes op)]))
  | ["enum"; raw] -> let* n = Option.to_result ~none:"bad int" (int_of_string_opt raw) in
    let option show = Option.fold ~none:"none" ~some:show in
    let all show values = values |> List.map (fun value -> string_of_int (show value) ^ ",") |> String.concat "" in
    Ok (String.concat ":" [option (fun d -> string_of_int (Depth.to_int d)) (Depth.of_int n);
      option (fun d -> string_of_int (Opcode.Push_bytes.to_int d)) (Opcode.Push_bytes.of_int n);
      option (fun d -> string_of_int (Topic_count.to_int d)) (Topic_count.of_int n); option Opcode.to_string (Opcode.decode n);
      all Depth.to_int Depth.all; all Opcode.Push_bytes.to_int Opcode.Push_bytes.all; all Topic_count.to_int Topic_count.all])
  | [] -> Error "empty request"
  | _ :: _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line -> dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error:" ^ text) |> print_endline)
