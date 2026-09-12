open Oracle_bytes
open Io_fixture_helpers
module Disk = Consensus_store_disk
module File = Checkpoint_file
let loaded = function
  | File.Absent -> "none"
  | File.Loaded {checkpoint; generation} -> string_of_int generation ^ ":" ^ hex (Bcs.encode Checkpoint_codec.checkpoint checkpoint)
let frame_payload text = Option.to_result ~none:"empty frame" (Seq.uncons (String.to_seq text)) |> Result.map (fun (tag, tail) ->
  (if Char.code tag = 1 then Frame.Record else Frame.Epoch_open), String.of_seq tail)
let rec entries = function
  | [] -> Ok [] | head :: tail -> let* head = raw head in let* head = frame_payload head in let* tail = entries tail in Ok (head :: tail)
let fake_store ops dir (origin : Record_codec.Meta.t) (walk : Disk.walk) =
  let fd : Io.fd = {raw=Unix.stdin; path=dir; ops} in
  let lock : Store_lock.t = {fd; path=Filename.concat dir Store_lock.lock_name} in
  let log : Append_log.t = {fd; lock; end_offset=64; next_seq=0} in
  ({origin={dir;epoch=origin.epoch;anchor=origin.epoch_start;parent=origin.epoch_parent};log;mirror=walk.store;
    last_meta=walk.last_meta;log_end_at_open=64;seq_at_open=0} : Disk.t)
let run = function
  | ["origin"] -> Ok (hex (Record_codec.Meta.encode {epoch=Units.Epoch.zero; epoch_start=Consensus_block.Number.genesis; epoch_parent=Consensus_block.genesis_parent}))
  | ["records"; dags] ->
      let* dags = raw dags in let* dags = Bcs.decode (Bcs.list Sub_dag.codec) dags |> Result.map_error Bcs.error_to_string in
      let* records = List.fold_left (fun acc block -> let* records = acc in
        let* record = Consensus_store.Record.of_wire (block, []) |> Result.map_error Consensus_store.Record.error_to_string in
        Ok (Record_codec.encode_record record :: records)) (Ok []) (Execution_fixture_helpers.blocks dags) in
      Ok (String.concat "," (List.rev_map hex records))
  | ["decode"; payload; generation] ->
      let* payload = raw payload in let* generation = integer generation in
      Ok (File.decode payload generation |> Result.fold ~ok:loaded ~error:(fun error -> "error:" ^ File.error_to_string error))
  | [op; dir; origin; frames; checkpoint; generation; initial; counts; failures; code] ->
      let* op = integer op in let* dir = raw dir in let* origin = raw origin in
      let* origin = Record_codec.Meta.decode origin |> Result.map_error Record_codec.error_to_string in
      let* frames = entries (csv frames) in
      let* walk = Disk.replay ~epoch:origin.epoch ~anchor:origin.epoch_start ~parent:origin.epoch_parent frames |> Result.map_error Disk.fault_to_string in
      let* checkpoint = raw checkpoint in let* checkpoint = Bcs.decode Checkpoint_codec.checkpoint checkpoint |> Result.map_error Bcs.error_to_string in
      let* generation = integer generation in let* initial = raw initial in let* counts = integers (csv counts) in let* code = fault code in
      let ops, trace = make_ops initial counts (csv failures) code in
      let store = fake_store ops dir origin walk in
      let before_fsync = Io.fsyncs () and before_bytes = Io.bytes_written () in
      let result = match op with
        | 0 -> Result.map string_of_int (File.save ~ops ~dir ~store checkpoint)
        | 1 -> Result.map loaded (File.load ~ops ~dir ())
        | 2 -> Result.map unit_text (File.guard_ahead ~store checkpoint)
        | 3 -> Result.map unit_text (File.guard_known ~store checkpoint)
        | 5 -> Result.map string_of_int (File.stored_generation ~ops ~dir)
        | _ -> Result.map string_of_int (File.publish ~ops ~dir ~generation checkpoint)
      in
      Ok (Result.fold ~ok:Fun.id ~error:(fun error -> "error:" ^ File.error_to_string error) result ^ "#"
        ^ string_of_int (Io.fsyncs () - before_fsync) ^ ":" ^ string_of_int (Io.bytes_written () - before_bytes)
        ^ "#" ^ String.concat "~" (List.rev !trace))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun error -> hex (Io.code_of error)) (Io.catching (fun () -> provoke code)))
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "fixture:" ^ error) (run (String.split_on_char ' ' line))))
