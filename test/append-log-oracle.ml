open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
let result_text = Result.fold ~ok:(fun () -> "ok") ~error:(fun error -> "error:" ^ Append_log.error_to_string error)
let run = function
  | ["header"; stored; wanted] ->
      let* stored=raw stored in let* wanted=raw wanted in
      Ok (result_text (Append_log.validate_header ~stored ~wanted))
  | ["mismatch"; stored; wanted] ->
      let* stored=raw stored in let* wanted=raw wanted in
      Ok (Option.fold ~none:"none" ~some:(fun error -> "error:" ^ Append_log.error_to_string error)
        (Append_log.mismatching ~stored ~wanted))
  | ["quote"; value] -> let* value=raw value in Ok (Printf.sprintf "%S" value)
  | ["error"; kind; first; second; path] ->
      let* first=integer first in let* second=integer second in
      let* error=match kind with
      | "0" -> Ok (Append_log.Io (Io.Failed {op=Io.Fsync;path;code="test fault"}))
      | "1" -> Ok (Append_log.Lock (Store_lock.Held {path}))
      | "2" -> Ok (Append_log.Lock (Store_lock.Io (Io.Would_block {op=Io.Lockf;path})))
      | "3" -> Ok (Append_log.Corrupt {at=first;why=Frame.Bad_body_tag {at=first};next_good=second})
      | "4" -> Ok (Append_log.Bad_payload_len {len=first;cap=second})
      | _ -> Error "bad error kind" in
      Ok (Append_log.error_to_string error)
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ error) (run (String.split_on_char ' ' line))))
