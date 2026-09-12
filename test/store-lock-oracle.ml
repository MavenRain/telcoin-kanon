open Oracle_bytes
open Io_fixture_helpers
let view = Result.fold ~ok:(fun (_ : Store_lock.t) -> "ok") ~error:(fun e -> "error:" ^ Store_lock.error_to_string e)
let release = Result.fold ~error:(fun (_ : Store_lock.error) -> "none") ~ok:(fun lock ->
  Result.fold ~ok:unit_text ~error:(fun e -> "error:" ^ Io.error_to_string e) (Store_lock.release lock))
let run = function
  | [dir; alias; failures; code] ->
      let* dir = raw dir in let* alias = raw alias in let* code = fault code in
      let base, trace = make_ops "" [] (csv failures) code in
      let ops = {base with Io_ops.realpath=(fun path -> let (_ : string) = base.Io_ops.realpath path in "/canonical")} in
      let first = Store_lock.acquire ~ops ~dir in
      let second = Store_lock.acquire ~ops ~dir:alias in
      let released_first = release first in
      let released_second = release second in
      let third = Store_lock.acquire ~ops ~dir in
      let released_third = release third in
      Ok (String.concat ";" [view first; view second; released_first; released_second; view third; released_third;
        string_of_int (List.length !(Store_lock.register))] ^ "#" ^ String.concat "~" (List.rev !trace))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun e -> hex (Io.code_of e)) (Io.catching (fun () -> provoke code)))
  | [] | [_] | [_; _] | [_; _; _] | _ :: _ :: _ :: _ :: _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun e -> "oracle-error:" ^ e) (run (String.split_on_char ' ' line))))
