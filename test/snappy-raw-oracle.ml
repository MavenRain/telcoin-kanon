open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let error_text error = "error:" ^ Snappy_raw.error_to_string error
let run = function
  | ["encode"; bytes] -> let* bytes=raw bytes in Ok (hex (Snappy_raw.encode bytes))
  | ["decode"; maximum; bytes] -> let* max_len=integer maximum in let* bytes=raw bytes in
      Ok (Result.fold ~error:error_text ~ok:(fun value -> "ok:" ^ hex value) (Snappy_raw.decode ~max_len bytes))
  | ["preamble"; bytes] -> let* bytes=raw bytes in
      Ok (Result.fold ~error:error_text ~ok:(fun (length,pos) -> string_of_int length ^ ":" ^ string_of_int pos)
        (Snappy_raw.preamble (Byte_reader.of_string bytes)))
  | ["tag"; length] -> let* length=integer length in
      let buf=Buffer.create 5 in Snappy_raw.put_literal_tag buf length; Ok (hex (Buffer.contents buf))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
