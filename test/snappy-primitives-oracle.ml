open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let optional_int = Option.fold ~none:"none" ~some:string_of_int
let run = function
  | ["read"; bytes; pos; len] ->
      let* bytes=raw bytes in let* pos=integer pos in let* len=integer len in
      let reader=Byte_reader.of_string bytes in
      Ok (String.concat "|" [string_of_bool (Byte_reader.inside reader ~pos ~len);
        Option.fold ~none:"none" ~some:(fun part -> "some:" ^ hex part) (Byte_reader.sub reader ~pos ~len);
        optional_int (Byte_reader.le reader ~pos ~len); optional_int (Byte_reader.byte reader ~pos);
        string_of_int (Byte_reader.length reader)])
  | ["digest"; bytes] -> let* bytes=raw bytes in
      let crc=Crc32c.digest bytes in Ok (string_of_int crc ^ ":" ^ string_of_int (Crc32c.mask crc))
  | ["update"; prev; bytes; pos; len] ->
      let* prev=integer prev in let* bytes=raw bytes in let* pos=integer pos in let* len=integer len in
      Ok (Result.fold ~ok:string_of_int ~error:(fun error -> "error:" ^ Crc32c.error_to_string error) (Crc32c.update prev bytes ~pos ~len))
  | ["mask"; crc] -> let* crc=integer crc in Ok (string_of_int (Crc32c.mask crc))
  | ["step"; reg; byte] -> let* reg=integer reg in let* byte=integer byte in Ok (string_of_int (Crc32c.step reg byte))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
