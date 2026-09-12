open Oracle_bytes
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let raw text = unhex (if String.equal text "-" then "" else text)
let head (h : Frame.head) =
  let kind = match h.kind with Frame.Record -> 1 | Frame.Epoch_open -> 2 in
  Printf.sprintf "%d:%d:%d" kind h.seq h.payload_len
let entry (h, payload) = head h ^ ":" ^ hex payload
let bad why = Printf.sprintf "error:%d:%s" (Frame.bad_offset why) (Frame.bad_to_string why)
let stop = function
  | Frame.Clean { at } -> Printf.sprintf "clean:%d" at
  | Frame.Torn { at; why } -> Printf.sprintf "torn:%d:%s" at (Frame.bad_to_string why)
  | Frame.Corrupt { at; why; next_good } -> Printf.sprintf "corrupt:%d:%d:%s" at next_good (Frame.bad_to_string why)
let run = function
  | ["hash"; input] -> let* input = raw input in Ok Digestif.BLAKE2B.(to_hex (digest_string input))
  | ["size"; length] -> let* payload_len = integer length in Ok (string_of_int (Frame.frame_size ~payload_len))
  | ["encode"; kind; seq; payload] ->
      let* seq = integer seq in let* payload = raw payload in
      let kind = if String.equal kind "1" then Frame.Record else Frame.Epoch_open in
      Ok (hex (Frame.encode ~kind ~seq ~payload))
  | ["decode"; input; at; expected] ->
      let* buf = raw input in let* at = integer at in let* expect_seq = integer expected in
      Ok (Result.fold ~error:bad ~ok:(fun (h, payload, next) -> entry (h, payload) ^ ":" ^ string_of_int next)
        (Frame.decode_at ~buf ~at ~expect_seq))
  | ["scan"; input; from] ->
      let* buf = raw input in let* from = integer from in
      let scanned = Frame.scan ~buf ~from in
      Ok (String.concat "" (List.map (fun value -> entry value ^ ";") scanned.frames) ^ "|" ^ stop scanned.stop)
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  let output = Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line)) in
  print_endline output)
