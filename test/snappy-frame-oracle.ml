open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let run = function
  | ["compress"; source] -> let* source=raw source in Ok (hex (Snappy_frame.compress source))
  | ["decompress"; maximum; source] -> let* max_len=integer maximum in let* source=raw source in
      Ok (Result.fold ~ok:(fun bytes -> "ok:" ^ hex bytes)
        ~error:(fun error -> "error:" ^ Snappy_frame.error_to_string error) (Snappy_frame.decompress ~max_len source))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
