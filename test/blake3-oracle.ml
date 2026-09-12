open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let run = function
  | [payload] -> let* payload = raw payload in Ok (hex (Blake3.hash payload))
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
