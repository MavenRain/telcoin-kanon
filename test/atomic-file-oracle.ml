open Oracle_bytes
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let raw text = unhex (if String.equal text "-" then "" else text)
let run = function
  | ["encode"; magic; format; generation; payload] ->
      let* magic = raw magic in let* format = integer format in
      let* generation = integer generation in let* payload = raw payload in
      Ok (hex (Atomic_file.encode ~magic ~format ~generation ~payload))
  | ["decode"; path; magic; format; buf] ->
      let* magic = raw magic in let* format = integer format in let* buf = raw buf in
      Ok (Result.fold ~error:(fun error -> "error:" ^ Atomic_file.error_to_string error)
        ~ok:(fun (generation, payload) -> string_of_int generation ^ ":" ^ hex payload)
        (Atomic_file.decode ~path ~magic ~format buf))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
