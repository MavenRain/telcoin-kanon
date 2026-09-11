let ( let* ) = Result.bind
let parse text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let uint n = Printf.sprintf "%Lu" n
let seed raw = let* bytes = Oracle_bytes.unhex raw in Option.to_result ~none:"bad seed" (Hash32.of_bytes bytes)
let next rng = let value, _ = Std_rng.next_u64 rng in uint value
let dispatch line =
  match String.split_on_char ' ' line with
  | ["stream"; key; count] ->
      let* key = seed key in let* count = parse count in
      let _, words = List.fold_left (fun (rng, words) _ -> let word, rng = Std_rng.next_u64 rng in rng, uint word :: words)
        (Std_rng.of_randomness key, []) (List.init count Fun.id) in Ok (String.concat "," (List.rev words))
  | ["range"; key; bounds] ->
      let* key = seed key in
      let* _, words = List.fold_left (fun acc raw ->
        let* rng, words = acc in let* bound = parse raw in
        Std_rng.random_range_inclusive rng ~bound
        |> Result.fold ~error:(fun _ -> Ok (rng, "negative" :: words))
             ~ok:(fun (word, rng) -> Ok (rng, string_of_int word :: words)))
        (Ok (Std_rng.of_randomness key, [])) (String.split_on_char ',' bounds) in
      Ok (String.concat "," (List.rev words))
  | ["choose"; key; size; count] ->
      let* key = seed key in let* size = parse size in let* amount = parse count in
      let selected, rng = Rand_seq.choose_multiple (Std_rng.of_randomness key) ~amount (List.init size Fun.id) in
      Ok (String.concat "," (List.map string_of_int selected) ^ ":" ^ next rng)
  | ["leader"; round] ->
      let* round = Option.to_result ~none:"bad round" (Int64.of_string_opt ("0u" ^ round)) in
      Ok (next (Std_rng.of_leader_round round))
  | _ -> Error "bad request"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  dispatch line |> Result.fold ~ok:Fun.id ~error:(fun text -> "error: " ^ text) |> print_endline)
