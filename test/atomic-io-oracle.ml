open Oracle_bytes
open Io_fixture_helpers
let loaded = Option.fold ~none:"none" ~some:(fun (generation, payload) -> string_of_int generation ^ ":" ^ hex payload)
let run = function
  | [op; dir; name; magic; format; generation; payload; counts; failures; code] ->
      let* op = integer op in let* dir = raw dir in let* name = raw name in let* magic = raw magic in
      let* format = integer format in let* generation = integer generation in let* payload = raw payload in
      let* counts = integers (csv counts) in let* code = fault code in
      let ops, trace = make_ops payload counts (csv failures) code in
      let before_fsync = Io.fsyncs () and before_bytes = Io.bytes_written () in
      let result = match op with
        | 0 -> Result.map unit_text (Atomic_file.save ~ops ~dir ~name ~magic ~format ~generation ~payload)
        | 1 -> Result.map loaded (Atomic_file.load ~ops ~dir ~name ~magic ~format)
        | _ -> Result.map string_of_bool (Atomic_file.sweep_temp ~ops ~dir ~name)
      in
      Ok (Result.fold ~ok:Fun.id ~error:(fun e -> "error:" ^ Atomic_file.error_to_string e) result
        ^ "#" ^ string_of_int (Io.fsyncs () - before_fsync) ^ ":" ^ string_of_int (Io.bytes_written () - before_bytes)
        ^ "#" ^ String.concat "~" (List.rev !trace))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun e -> hex (Io.code_of e)) (Io.catching (fun () -> provoke code)))
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun e -> "oracle-error:" ^ e) (run (String.split_on_char ' ' line))))
