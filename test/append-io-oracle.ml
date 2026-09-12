open Oracle_bytes
open Io_fixture_helpers
let kind_of value = if value = 1 then Frame.Record else Frame.Epoch_open
let kind_text = function Frame.Record -> "1" | Frame.Epoch_open -> "2"
let log_text log = string_of_int (Append_log.end_offset log) ^ ":" ^ string_of_int (Append_log.next_seq log)
let heal_text = function
  | Append_log.No_heal -> "clean"
  | Append_log.Healed_tail {last_good; dropped} -> "torn:" ^ string_of_int last_good ^ ":" ^ string_of_int dropped
let opened_text (opened : Append_log.opened) = String.concat ";" [log_text opened.log; heal_text opened.heal; string_of_int opened.frames;
  String.concat "" (List.map (fun (kind, payload) -> "[" ^ kind_text kind ^ ":" ^ hex payload ^ "]") opened.payloads)]
let close log = Result.fold ~ok:unit_text ~error:(fun error -> "error:" ^ Append_log.error_to_string error) (Append_log.close log)
let attempt log kind payload = Result.fold ~ok:(fun advanced -> advanced, log_text advanced)
  ~error:(fun error -> log, "error:" ^ Append_log.error_to_string error) (Append_log.append log ~kind ~payload)
let writes op log kind payload retry = match op with
  | 0 -> close log
  | 1 -> let advanced, outcome = attempt log kind payload in outcome ^ ";" ^ close advanced
  | _ -> let advanced, first = attempt log kind payload in let advanced, second = attempt advanced kind retry in
      first ^ ";" ^ second ^ ";" ^ close advanced
let run = function
  | [op; dir; header; kind; payload; retry; initial; counts; failures; code] ->
      let* op = integer op in let* dir = raw dir in let* header = raw header in let* kind = integer kind in
      let* payload = raw payload in let* retry = raw retry in let* initial = raw initial in
      let* counts = integers (csv counts) in let* code = fault code in
      let ops, trace = make_ops initial counts (csv failures) code in
      let before_fsync = Io.fsyncs () and before_bytes = Io.bytes_written () in
      let result = Result.fold ~error:(fun error -> "error:" ^ Append_log.error_to_string error)
        ~ok:(fun opened -> opened_text opened ^ ";" ^ writes op opened.Append_log.log (kind_of kind) payload retry)
        (Append_log.open_ ~ops ~dir ~file_header:header) in
      Ok (result ^ ";" ^ string_of_int (List.length !(Store_lock.register)))
      |> Result.map (fun result -> result ^ "#" ^ string_of_int (Io.fsyncs () - before_fsync) ^ ":" ^ string_of_int (Io.bytes_written () - before_bytes)
        ^ "#" ^ String.concat "~" (List.rev !trace))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun e -> hex (Io.code_of e)) (Io.catching (fun () -> provoke code)))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun e -> "oracle-error:" ^ e) (run (String.split_on_char ' ' line))))
