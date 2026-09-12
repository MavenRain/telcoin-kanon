open Oracle_bytes
let raw text = unhex (if String.equal text "-" then "" else text)
let integer text = Option.to_result ~none:"bad integer" (int_of_string_opt text)
type fault = Absent | Contended | Not_dir | Exists
let fault text = Option.to_result ~none:"bad fault" (List.assoc_opt text
  ["absent", Absent; "contended", Contended; "notdir", Not_dir; "exists", Exists])
let provoke = function
  | Absent -> let (_ : Unix.stats) = Unix.stat "/tn-durable-faults-no-such-root/no-such-file" in ()
  | Contended ->
      let readable, writable = Unix.pipe () in
      Fun.protect ~finally:(fun () -> Unix.close readable; Unix.close writable) (fun () ->
        Unix.set_nonblock readable;
        let (_ : int) = Unix.read readable (Bytes.create 1) 0 1 in ())
  | Not_dir -> let (_ : Unix.stats) = Unix.stat "/dev/null/child" in ()
  | Exists -> Unix.mkdir "/" 0o700
let flag value = Option.fold ~none:"unknown" ~some:snd
  (List.find_opt (fun (candidate, _) -> candidate = value)
    [Unix.O_RDONLY,"0"; Unix.O_WRONLY,"1"; Unix.O_RDWR,"2"; Unix.O_CREAT,"3"; Unix.O_EXCL,"4"])
let seek_text = function Unix.SEEK_SET -> "set" | Unix.SEEK_CUR -> "cur" | Unix.SEEK_END -> "end"
let lock_text = function
  | Unix.F_ULOCK -> "unlock" | Unix.F_LOCK -> "lock" | Unix.F_TLOCK -> "try-lock"
  | Unix.F_TEST -> "test" | Unix.F_RLOCK -> "read-lock" | Unix.F_TRLOCK -> "try-read-lock"
let unit_text () = "ok"
let make_ops payload counts failures fault =
  let trace = ref [] and hits = Hashtbl.create 13 and position = ref 0 and remaining = ref counts in
  let emit name args body =
    trace := (name ^ "|" ^ String.concat "," (List.map hex args) ^ "|" ^ hex body) :: !trace;
    let hit = 1 + Option.value ~default:0 (Hashtbl.find_opt hits name) in
    Hashtbl.replace hits name hit;
    if List.mem (name ^ ":" ^ string_of_int hit) failures then provoke fault else ()
  in
  let count fallback = match !remaining with
    | [] -> fallback | head :: tail -> remaining := tail; head
  in
  let ops : Io_ops.t = {
    openfile = (fun p flags perm -> emit "open" (p :: string_of_int perm :: List.map flag flags) ""; Unix.stdin);
    close = (fun _ -> emit "close" ["7"] "");
    write = (fun _ buffer off length -> emit "write" ["7"; string_of_int off; string_of_int length] (Bytes.to_string buffer); count length);
    read = (fun _ buffer off length ->
      (* Bytes.create leaves the unread suffix unspecified. Trace initialized bytes only. *)
      emit "read" ["7"; string_of_int off; string_of_int length] (String.of_seq (Seq.take off (Bytes.to_seq buffer)));
      let () = if off >= 0 && length >= 0 && off + length <= Bytes.length buffer then Bytes.blit_string (String.make length '\000') 0 buffer off length else () in (* @total-accessor *)
      let start = min !position (String.length payload) in
      let available = max 0 (String.length payload - start) in
      let reported = count (min length available) in
      let copied = min available (min length (max 0 reported)) in
      if start >= 0 && off >= 0 && copied >= 0 && start + copied <= String.length payload && off + copied <= Bytes.length buffer then (
        Bytes.blit_string payload start buffer off copied; (* @total-accessor *)
        position := !position + copied; reported) else 0);
    fsync = (fun _ -> emit "fsync" ["7"] "");
    ftruncate = (fun _ length -> emit "ftruncate" ["7"; string_of_int length] "");
    lseek = (fun _ offset whence ->
      emit "lseek" ["7"; string_of_int offset; seek_text whence] "";
      let base = match whence with Unix.SEEK_SET -> 0 | Unix.SEEK_CUR -> !position | Unix.SEEK_END -> String.length payload in
      position := base + offset; !position);
    rename = (fun src dst -> emit "rename" [src; dst] "");
    mkdir = (fun p perm -> emit "mkdir" [p; string_of_int perm] "");
    unlink = (fun p -> emit "unlink" [p] "");
    file_exists = (fun p -> emit "stat" [p] ""; true);
    lockf = (fun _ command length -> emit "lockf" ["7"; lock_text command; string_of_int length] "");
    realpath = (fun p -> emit "realpath" [p] ""; "/resolved/" ^ p);
  } in
  ops, trace
let run_io op path payload at len counts failures fault =
  let ops, trace = make_ops payload counts failures fault in
  let fd : Io.fd = {raw=Unix.stdin; path; ops} in
  let body op fd = match op with
    | 0 -> Result.map unit_text (Io.write_all fd payload)
    | 1 -> Result.map hex (Io.pread_exact fd ~at ~len)
    | 2 -> Result.map hex (Io.pread_all fd ~at ~len)
    | 3 -> Result.map unit_text (Io.fsync fd)
    | 4 -> Result.map unit_text (Io.ftruncate fd ~at)
    | 5 -> Result.map string_of_int (Io.size fd)
    | 6 -> Result.map unit_text (Io.seek_to fd ~at)
    | 7 -> Result.map unit_text (Io.lock_exclusive fd ~path:payload)
    | _ -> Result.map unit_text (Io.close_fd fd)
  in
  let before_fsync = Io.fsyncs () and before_bytes = Io.bytes_written () in
  let result = match op with
    | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 -> body op fd
    | 9 -> Result.map unit_text (Io.fsync_dir ~ops ~path)
    | 10 -> Result.map unit_text (Io.rename_over ~ops ~src:path ~dst:payload)
    | 11 -> Result.map unit_text (Io.mkdir_p ~ops ~path)
    | 12 -> Result.map unit_text (Io.unlink_if_present ~ops ~path)
    | 13 -> Result.map string_of_bool (Io.exists ~ops ~path)
    | 14 -> Result.map hex (Io.realpath ~ops ~path)
    | 15 -> Result.map hex (Io.read_whole ~ops ~path)
    | 16 -> Io.with_file ~ops ~path ~mode:Io.Write_create_excl (body 0)
    | 17 -> Io.with_file ~ops ~path ~mode:Io.Read_write_create (body 3)
    | _ -> Io.with_file ~ops ~path ~mode:Io.Read_only (body 1)
  in
  Result.fold ~ok:Fun.id ~error:(fun e -> "error:" ^ Io.error_to_string e) result
  ^ "#" ^ string_of_int (Io.fsyncs () - before_fsync) ^ ":" ^ string_of_int (Io.bytes_written () - before_bytes)
  ^ "#" ^ String.concat "~" (List.rev !trace)
let csv text = if String.equal text "-" then [] else String.split_on_char ',' text
let rec integers = function
  | [] -> Ok [] | head :: tail -> let* head = integer head in let* tail = integers tail in Ok (head :: tail)
let run = function
  | ["realpath"; path] -> let* path = raw path in
      Ok (Result.fold ~ok:(fun value -> "ok:" ^ hex value) ~error:(fun error -> "error:" ^ hex (Io.error_to_string error))
        (Io.realpath ~ops:Io_ops.real ~path))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun e -> hex (Io.code_of e)) (Io.catching (fun () -> provoke code)))
  | [op; path; payload; at; len; counts; failures; code] ->
      let* op = integer op in let* path = raw path in let* payload = raw payload in
      let* at = integer at in let* len = integer len in let* counts = integers (csv counts) in let* code = fault code in
      Ok (run_io op path payload at len counts (csv failures) code)
  | _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun e -> "oracle-error:" ^ e) (run (String.split_on_char ' ' line))))
