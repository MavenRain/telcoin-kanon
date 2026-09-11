let ( let* ) = Result.bind
let parse text = Option.to_result ~none:"bad number" (int_of_string_opt text)
let seed text = Option.to_result ~none:"bad seed" (Int64.of_string_opt ("0u" ^ text))
let uint value = Printf.sprintf "%Lu" value
let pair a b = a ^ ":" ^ uint b
let render_list codec values =
  Bcs.encode codec values |> String.to_seq |> Seq.map (fun c -> Printf.sprintf "%02x" (Char.code c)) |> List.of_seq |> String.concat ""
let std_list kind text =
  let pieces = if String.equal text "empty" then [] else String.split_on_char ',' text in
  let* values = List.fold_right (fun piece tail -> let* value = parse piece in let* rest = tail in Ok (value :: rest)) pieces (Ok []) in
  let render values =
    match kind with
    | "head" -> Ok (string_of_int (Nonempty.head values))
    | "last" -> Ok (string_of_int (Nonempty.last values))
    | "length" -> Ok (string_of_int (Nonempty.length values))
    | "fold" -> Ok (Nonempty.fold_left (fun acc value -> acc ^ ";" ^ string_of_int value) "" values)
    | "map" -> Ok (render_list (Bcs.list Bcs.bytes) (Nonempty.to_list (Nonempty.map string_of_int values)))
    | "append" -> Ok (render_list (Bcs.list Bcs.u8) (Nonempty.to_list (Nonempty.append_list values [8; 9])))
    | "compare" -> Ok (string_of_int (Int.compare (Nonempty.compare Int.compare values (Nonempty.cons 2 [3])) 0))
    | "equal" -> Ok (if Nonempty.equal (fun a b -> a mod 2 = b mod 2) values (Nonempty.cons 2 [3]) then "1" else "0")
    | _ -> Error "unknown list operation"
  in
  Option.fold ~none:(Ok "none") ~some:render (Nonempty.of_list values)
let dispatch line =
  match String.split_on_char ' ' line with
  | ["next"; text] -> let* state = seed text in let value, next = Prng.next_int64 state in Ok (pair (uint value) next)
  | ["split"; text] -> let* state = seed text in let left, right = Prng.split state in Ok (pair (uint left) right)
  | ["range"; text; lower; upper] ->
      let* state = seed text in let* lo = parse lower in let* hi = parse upper in
      let value, next = Prng.int_in state ~lo ~hi in Ok (pair (string_of_int value) next)
  | [kind; text] -> std_list kind text
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun message -> "error: " ^ message) |> print_endline)
