open Oracle_bytes
open Io_fixture_helpers
module Disk = Consensus_store_disk
module Record = Consensus_store.Record
let meta_option = Option.fold ~none:"none" ~some:hex
let mirror (store : Disk.t) = String.concat ";" [Execution_fixture_helpers.store_text (Disk.mirror store);
  meta_option store.last_meta; string_of_int (Disk.fsyncs store); string_of_int (Disk.bytes_appended store)]
let write previous result = Result.fold ~ok:(fun store -> store, "ok;" ^ mirror store)
  ~error:(fun error -> previous, "error:" ^ Disk.write_error_to_string error ^ ";" ^ mirror previous) result
let action store raw = Option.fold ~none:(store, "fixture:action") ~some:(fun (tag, tail) ->
  let payload = String.of_seq tail in
  match Char.code tag with
  | 0 -> Record_codec.decode_record payload |> Result.fold
      ~error:(fun error -> store, "fixture:" ^ Record_codec.error_to_string error)
      ~ok:(fun record -> write store (Disk.receive store record))
  | op -> Bcs.decode Checkpoint_codec.epoch payload |> Result.fold
      ~error:(fun (_ : Bcs.error) -> store, "fixture:epoch")
      ~ok:(fun epoch -> write store (if op = 1 then Disk.open_epoch store ~epoch else Disk.reopen_epoch store ~epoch)))
  (Seq.uncons (String.to_seq raw))
let heal = function
  | Append_log.No_heal -> "clean"
  | Append_log.Healed_tail {last_good; dropped} -> "torn:" ^ string_of_int last_good ^ ":" ^ string_of_int dropped
let report (report : Disk.report) = String.concat ";" [heal report.heal; string_of_int report.frames; string_of_bool report.created]
let rec raw_list = function
  | [] -> Ok [] | head :: tail -> let* head = raw head in let* tail = raw_list tail in Ok (head :: tail)
let encoded_list text = raw_list (csv text)
let frame_payload text = Option.to_result ~none:"empty frame" (Seq.uncons (String.to_seq text)) |> Result.map (fun (tag, tail) ->
  (if Char.code tag = 1 then Frame.Record else Frame.Epoch_open), String.of_seq tail)
let rec frame_payloads = function
  | [] -> Ok [] | head :: tail -> let* head = frame_payload head in let* tail = frame_payloads tail in Ok (head :: tail)
let run = function
  | ["open"; dir; origin; actions; initial; counts; failures; code] ->
      let* dir = raw dir in let* origin = raw origin in let* origin = Record_codec.Meta.decode origin |> Result.map_error Record_codec.error_to_string in
      let* actions = encoded_list actions in let* initial = raw initial in let* counts = integers (csv counts) in let* code = fault code in
      let ops, trace = make_ops initial counts (csv failures) code in
      let before_fsync = Io.fsyncs () and before_bytes = Io.bytes_written () in
      let result = Disk.open_ ~ops ~dir ~epoch:origin.epoch ~anchor:origin.epoch_start ~parent:origin.epoch_parent ()
        |> Result.fold ~error:(fun error -> "error:" ^ Disk.fault_to_string error) ~ok:(fun (opened, opened_report) ->
          let final, outcomes = List.fold_left (fun (store, outcomes) raw -> let store, outcome = action store raw in store, outcomes ^ "[" ^ outcome ^ "]") (opened, "") actions in
          let closed = Disk.close final |> Result.fold ~ok:unit_text ~error:(fun error -> "error:" ^ Disk.fault_to_string error) in
          String.concat ";" [report opened_report; mirror opened; outcomes; mirror final; closed]) in
      Ok (result ^ ";" ^ string_of_int (List.length !(Store_lock.register)) ^ "#"
        ^ string_of_int (Io.fsyncs () - before_fsync) ^ ":" ^ string_of_int (Io.bytes_written () - before_bytes)
        ^ "#" ^ String.concat "~" (List.rev !trace))
  | ["replay"; origin; entries] ->
      let* origin = raw origin in let* origin = Record_codec.Meta.decode origin |> Result.map_error Record_codec.error_to_string in
      let* entries = encoded_list entries in let* payloads = frame_payloads entries in
      Ok (Disk.replay ~epoch:origin.epoch ~anchor:origin.epoch_start ~parent:origin.epoch_parent payloads |> Result.fold
        ~error:(fun error -> "error:" ^ Disk.fault_to_string error) ~ok:(fun (walk : Disk.walk) -> String.concat ";"
          [Execution_fixture_helpers.store_text walk.store; string_of_int walk.at; string_of_int walk.seq; meta_option walk.last_meta]))
  | ["records"; dags; bodies] ->
      let* dags = raw dags in let* dags = Bcs.decode (Bcs.list Sub_dag.codec) dags |> Result.map_error Bcs.error_to_string in
      let* bodies = raw bodies in let* bodies = Bcs.decode (Bcs.list Batch.codec) bodies |> Result.map_error Bcs.error_to_string in
      let* records = List.fold_left (fun acc block -> let* records = acc in
        let* record = Record.of_wire (block, bodies) |> Result.map_error Record.error_to_string in Ok (Record_codec.encode_record record :: records))
        (Ok []) (Execution_fixture_helpers.blocks dags) in
      Ok (String.concat "," (List.rev_map hex records))
  | ["origin"] -> Ok (hex (Record_codec.Meta.encode {epoch=Units.Epoch.zero; epoch_start=Consensus_block.Number.genesis; epoch_parent=Consensus_block.genesis_parent}))
  | ["meta"; code] -> let* code = fault code in
      Ok (Result.fold ~ok:(fun () -> "unexpected success") ~error:(fun e -> hex (Io.code_of e)) (Io.catching (fun () -> provoke code)))
  | [] | _ :: _ -> Error "bad command"
let () = In_channel.input_lines stdin |> List.iter (fun line ->
  print_endline (Result.fold ~ok:Fun.id ~error:(fun error -> "fixture:" ^ error) (run (String.split_on_char ' ' line))))
